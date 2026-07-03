import {
	type RedirectTracker,
	type ReferrerPolicyData,
	type SiteDirective,
} from "@/types";
import { getDB } from "@/shared/security/db";

// Persist the redirect trackers for an hour
const TRACKER_EXPIRY = 60 * 60 * 1000;
const SITE_HIERARCHY: Record<SiteDirective, number> = {
	none: 0,
	"same-origin": 1,
	"same-site": 2,
	"cross-site": 3,
};

// Redirect trackers live for a single request (or the few hops of a redirect
// chain), all handled by the same service worker instance, so they're kept
// in memory instead of costing four awaited IndexedDB transactions per
// proxied request. Losing them to a worker restart mid-chain only means one
// Sec-Fetch-Site header is computed from the final hop instead of the whole
// chain - the same graceful fallback as an expired tracker.
const trackers = new Map<string, RedirectTracker>();
let lastTrackerSweep = Date.now();

/** Drop abandoned trackers (redirect chains that never completed). */
function sweepExpiredTrackers(): void {
	const now = Date.now();
	if (now - lastTrackerSweep < TRACKER_EXPIRY) return;
	lastTrackerSweep = now;

	for (const [url, tracker] of trackers) {
		if (now - tracker.chainStarted > TRACKER_EXPIRY) trackers.delete(url);
	}
}

/**
 * Initialize tracking for a new request that might redirect
 *
 * @param requestUrl URL of the request being made
 * @param referrer Referrer URL of the request, or `null`
 * @param initialSite Initial Sec-Fetch-Site directive
 */
export async function initializeTracker(
	requestUrl: string,
	referrer: string | null,
	initialSite: string
): Promise<void> {
	sweepExpiredTrackers();
	if (trackers.has(requestUrl)) return;

	trackers.set(requestUrl, {
		originalReferrer: referrer || "",
		mostRestrictiveSite: initialSite as SiteDirective,
		referrerPolicy: "",
		chainStarted: Date.now(),
	});
}

/**
 * Update tracker when a redirect is encountered
 *
 * @param originalUrl URL that is redirecting
 * @param redirectUrl URL being redirected to
 * @param newReferrerPolicy Referrer Policy from the redirect response
 */
export async function updateTracker(
	originalUrl: string,
	redirectUrl: string,
	newReferrerPolicy?: string
): Promise<void> {
	const tracker = trackers.get(originalUrl);
	if (!tracker) return;

	trackers.delete(originalUrl);
	if (newReferrerPolicy) {
		tracker.referrerPolicy = newReferrerPolicy;
	}
	trackers.set(redirectUrl, tracker);
}

/**
 * Get most restrictive site value for a request
 *
 * @param requestUrl The URL of the current request
 * @param currentSite The current `Sec-Fetch-Site` directive for this request
 * @returns Most restrictive `Sec-Fetch-Site` directive from the redirect chain
 */
export async function getMostRestrictiveSite(
	requestUrl: string,
	currentSite: string
): Promise<string> {
	const tracker = trackers.get(requestUrl);
	if (!tracker) return currentSite;

	const trackedValue = SITE_HIERARCHY[tracker.mostRestrictiveSite];
	const currentValue = SITE_HIERARCHY[currentSite as SiteDirective] ?? 0;

	if (currentValue > trackedValue) {
		tracker.mostRestrictiveSite = currentSite as SiteDirective;

		return currentSite;
	}

	return tracker.mostRestrictiveSite;
}

/**
 * Clean up tracker after request completes
 * @param requestUrl URL of the completed request
 */
export async function cleanTracker(requestUrl: string): Promise<void> {
	trackers.delete(requestUrl);
}

/**
 * Clean up expired trackers
 */
export async function cleanExpiredTrackers(): Promise<void> {
	lastTrackerSweep = 0;
	sweepExpiredTrackers();
}

// Referrer policies are keyed by page URL and outlive any one request, so
// they stay in IndexedDB (pages outlive service worker restarts) - but every
// response that carries a Referer header looks one up, so reads go through a
// small in-memory cache. Absence is cached too (`null`): most referrers have
// no stored policy, and without a negative entry each of those would still
// pay an IndexedDB read per request. This worker is the only writer, so the
// cache can't go stale.
const REFERRER_POLICY_CACHE_MAX = 512;
const referrerPolicyCache = new Map<string, ReferrerPolicyData | null>();

function cacheReferrerPolicy(url: string, data: ReferrerPolicyData | null) {
	if (referrerPolicyCache.size >= REFERRER_POLICY_CACHE_MAX) {
		// drop the oldest entry; insertion order is a fine eviction heuristic
		referrerPolicyCache.delete(referrerPolicyCache.keys().next().value);
	}
	referrerPolicyCache.set(url, data);
}

/**
 * Store referrer policy for a URL
 *
 * @param url URL to store the policy for
 * @param policy Referrer policy to store
 * @param referrer The referrer URL that set this policy
 */
export async function storeReferrerPolicy(
	url: string,
	policy: string,
	referrer: string
): Promise<void> {
	const data: ReferrerPolicyData = { policy, referrer };
	referrerPolicyCache.delete(url);
	cacheReferrerPolicy(url, data);
	const db = await getDB();
	await db.put("referrerPolicies", data, url);
}

/**
 * Get referrer policy data for a URL
 *
 * @param url URL to get the policy for
 * @returns Referrer policy data if found, or `null`
 */
export async function getReferrerPolicy(
	url: string
): Promise<ReferrerPolicyData | null> {
	const cached = referrerPolicyCache.get(url);
	if (cached !== undefined) return cached;

	const db = await getDB();
	const data = (await db.get("referrerPolicies", url)) || null;
	cacheReferrerPolicy(url, data);

	return data;
}
