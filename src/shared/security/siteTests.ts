import { type URLMeta } from "@rewriters/url";

import type {
	default as BareClient,
	BareResponseFetch,
} from "@mercuryworkshop/bare-mux";
import { getDB } from "@/shared/security/db";

// Cache every hour
const CACHE_DURATION_MINUTES = 60;
const CACHE_KEY = "publicSuffixList";

// Don't re-attempt a failed public-suffix-list download on every request;
// fall back to the naive eTLD+1 heuristic for a while instead
const FETCH_RETRY_MS = 60 * 1000;

/**
 * The public suffix list indexed for O(labels) lookups. The raw list is ~10k
 * rules; scanning it per request (as this used to) costs more than the fetch
 * being classified. Rules are split into exact matches, wildcard rules
 * (`*.ck`, stored as their parent `ck`), and exception rules (`!www.ck`,
 * stored as `www.ck`).
 */
type SuffixIndex = {
	exact: Set<string>;
	wildcard: Set<string>;
	exception: Set<string>;
};

let suffixIndex: SuffixIndex | null = null;
let suffixIndexExpiry = 0;
let suffixLoadPromise: Promise<void> | null = null;
let lastFetchFailure = 0;

// registrable domains repeat heavily within a page (same CDN/analytics hosts
// on every request), so memoize per hostname
const REGISTRABLE_CACHE_MAX = 4096;
const registrableCache = new Map<string, string>();

function buildSuffixIndex(rules: string[]): SuffixIndex {
	const exact = new Set<string>();
	const wildcard = new Set<string>();
	const exception = new Set<string>();

	for (const rule of rules) {
		if (rule.startsWith("!")) exception.add(rule.substring(1));
		else if (rule.startsWith("*.")) wildcard.add(rule.substring(2));
		else exact.add(rule);
	}

	return { exact, wildcard, exception };
}

/**
 * Gets cached Public Suffix List
 *
 * @returns Cached Public Suffix List data if not expired, or `null`
 */
async function getCachedSuffixList(): Promise<{
	data: string[];
	expiry: number;
} | null> {
	const db = await getDB();

	return (await db.get("publicSuffixList", CACHE_KEY)) || null;
}

/**
 * Stores public suffix list
 *
 * @param data Public Suffix list data to cache
 */
async function setCachedSuffixList(data: string[]): Promise<void> {
	const db = await getDB();
	await db.put(
		"publicSuffixList",
		{
			data,
			expiry: Date.now() + CACHE_DURATION_MINUTES * 60 * 1000,
		},
		CACHE_KEY
	);
}

/**
 * Emulate `Sec-Fetch-Site` header using the referrer (another reason why Force Referrer is now a needed SJ feature)
 */
export async function getSiteDirective(
	meta: URLMeta,
	referrerURL: URL,
	client: BareClient
): Promise<string> {
	if (!referrerURL) {
		return "none";
	}

	if (meta.origin.origin === referrerURL.origin) {
		return "same-origin";
	}

	const sameSite = await isSameSite(meta.origin, referrerURL, client);
	if (sameSite) {
		return "same-site";
	}

	return "cross-site";
}

/**
 * Tests if the two URLs are from the same site.
 * This will be used in the response header rewriter.
 *
 * @see https://developer.mozilla.org/en-US/docs/Glossary/Site
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site#directives
 *
 * @param url1 First URL to compare
 * @param url2 Second URL to compare
 * @param client `BareClient` instance used for fetching
 * @returns Whether the two URLs are from the same site
 */
export async function isSameSite(
	url1: URL,
	url2: URL,
	client: BareClient
): Promise<boolean> {
	const registrableDomain1 = await getRegistrableDomain(url1, client);
	const registrableDomain2 = await getRegistrableDomain(url2, client);

	return registrableDomain1 === registrableDomain2;
}

/**
 * Gets the registrable domain (eTLD+1) for a URL
 * @param url URL to get registrable domain for
 * @param client `BareClient` instance for fetching public suffix list
 * @returns Registrable domain
 */
async function getRegistrableDomain(
	url: URL,
	client: BareClient
): Promise<string> {
	const hostname = url.hostname.toLowerCase();
	const cached = registrableCache.get(hostname);
	if (cached !== undefined) return cached;

	await ensureSuffixIndex(client);

	const registrable = computeRegistrableDomain(hostname, suffixIndex);
	if (registrableCache.size >= REGISTRABLE_CACHE_MAX) registrableCache.clear();
	registrableCache.set(hostname, registrable);

	return registrable;
}

/**
 * Matches a hostname against the suffix index per the PSL algorithm: the
 * prevailing rule is an exception rule if one matches, otherwise the matching
 * rule with the most labels. With no match (or no list available) it falls
 * back to treating the last label as the public suffix.
 *
 * @see https://github.com/publicsuffix/list/wiki/Format#algorithm
 */
function computeRegistrableDomain(
	hostname: string,
	index: SuffixIndex | null
): string {
	const labels = hostname.split(".");
	if (!index) return labels.slice(-2).join(".");

	let suffixLabelCount = 0;
	let exceptionLabelCount = 0;
	let candidate = "";
	let parent = "";

	for (let i = labels.length - 1; i >= 0; i--) {
		parent = candidate;
		candidate = i === labels.length - 1 ? labels[i] : labels[i] + "." + parent;
		const labelCount = labels.length - i;

		if (index.exception.has(candidate)) {
			exceptionLabelCount = labelCount;
			break;
		}
		// a wildcard rule `*.X` matches any candidate that is exactly one label
		// deeper than X; `parent` is the candidate from the previous iteration
		if (index.exact.has(candidate) || (parent && index.wildcard.has(parent))) {
			suffixLabelCount = labelCount;
		}
	}

	// an exception rule is itself the registrable domain; otherwise it's the
	// matched public suffix plus one label, defaulting to eTLD+1
	const registrableLabelCount = exceptionLabelCount
		? exceptionLabelCount
		: suffixLabelCount
			? suffixLabelCount + 1
			: 2;

	return labels.slice(-registrableLabelCount).join(".");
}

/**
 * Ensures the in-memory suffix index exists and is fresh. All concurrent
 * callers share one load (a page's worth of parallel cross-origin requests
 * used to each start their own ~230 KB list download on a cold cache), and a
 * failed download degrades to the stale index / naive fallback instead of
 * failing the proxied request outright.
 */
async function ensureSuffixIndex(client: BareClient): Promise<void> {
	const now = Date.now();
	if (suffixIndex && now < suffixIndexExpiry) return;
	if (now - lastFetchFailure < FETCH_RETRY_MS) return;

	suffixLoadPromise ??= loadSuffixIndex(client).finally(() => {
		suffixLoadPromise = null;
	});

	await suffixLoadPromise;
}

async function loadSuffixIndex(client: BareClient): Promise<void> {
	try {
		// load the cached list even when it's expired: if the refresh below
		// fails, serving a stale list is far more accurate than the naive
		// eTLD+1 fallback (which breaks multi-label suffixes like co.uk)
		const cached = await getCachedSuffixList();
		if (cached) {
			suffixIndex = buildSuffixIndex(cached.data);
			suffixIndexExpiry = cached.expiry;
			registrableCache.clear();
			if (Date.now() < cached.expiry) return;
		}
	} catch {
		// a broken IndexedDB read shouldn't stop the network path below
	}

	try {
		const rules = await fetchPublicSuffixList(client);
		suffixIndex = buildSuffixIndex(rules);
		suffixIndexExpiry = Date.now() + CACHE_DURATION_MINUTES * 60 * 1000;
		registrableCache.clear();
		await setCachedSuffixList(rules);
	} catch (err) {
		// keep serving the stale index if there is one; otherwise callers fall
		// back to the naive heuristic until the retry window elapses
		lastFetchFailure = Date.now();
		console.warn("failed to refresh public suffix list:", err);
	}
}

async function fetchPublicSuffixList(client: BareClient): Promise<string[]> {
	let publicSuffixesResponse: BareResponseFetch;
	try {
		publicSuffixesResponse = await client.fetch(
			"https://publicsuffix.org/list/public_suffix_list.dat"
		);
	} catch (err) {
		throw new Error(`Failed to fetch public suffix list: ${err}`);
	}
	const publicSuffixesRaw = await publicSuffixesResponse.text();

	return publicSuffixesRaw
		.split("\n")
		.map((line) => {
			const trimmed = line.trim();
			const spaceIndex = trimmed.indexOf(" ");

			return spaceIndex > -1 ? trimmed.substring(0, spaceIndex) : trimmed;
		})
		.filter((line) => line && !line.startsWith("//"));
}

/**
 * Gets parsed Public Suffix list from the API.
 *
 * Complies with the standard format.
 * @see https://github.com/publicsuffix/list/wiki/Format#format
 *
 * @param {BareClient} client `BareClient` instance used for fetching
 * @returns {Promise<string[]>} Parsed Public Suffix list
 *
 * @throws {Error} If an error occurs while fetching from the Public Suffix List
 */
export async function getPublicSuffixList(
	client: BareClient
): Promise<string[]> {
	const cached = await getCachedSuffixList();
	if (cached && Date.now() < cached.expiry) {
		return cached.data;
	}

	const publicSuffixes = await fetchPublicSuffixList(client);
	await setCachedSuffixList(publicSuffixes);

	return publicSuffixes;
}
