/**
 * HTTP caching policy for Sherpa's rewritten responses.
 *
 * A service worker's synthesized responses are never stored in the browser's
 * HTTP cache, and the proxy transport has no cache of its own, so without this
 * every navigation re-downloads *and* re-rewrites every byte a page touches -
 * forever, no matter what `Cache-Control` the origin sent. Repeat visits were
 * measured at ~10x slower than an unproxied load for that reason
 * (`bench/bottleneck/README.md`).
 *
 * This module is the decision layer: pure functions over headers, with no
 * `CacheStorage` and no `fetch`, so the rules are unit-testable. The storage
 * glue lives in `@/worker/cache`.
 *
 * Sherpa's cache is a *private* cache (one browser profile, not shared between
 * users), so RFC 9111's private-cache rules apply: `private` is storable,
 * `s-maxage` is not consulted.
 */

/** A response header record as produced by `flattenResponseHeaders`. */
export type HeaderRecord = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderRecord, name: string): string | undefined {
	const value = headers[name];
	if (value === undefined) return undefined;

	return Array.isArray(value) ? value[0] : value;
}

/**
 * Splits a `Cache-Control` value into its directives.
 *
 * Directive names are case-insensitive and values may be quoted
 * (`no-cache="set-cookie"`), so neither a `split(",")` nor a regex over the
 * raw string is safe - a comma inside a quoted value would split a directive
 * in half.
 */
export function parseCacheControl(
	value: string | string[] | undefined | null
): Map<string, string> {
	const directives = new Map<string, string>();
	if (value === undefined || value === null) return directives;

	const raw = Array.isArray(value) ? value.join(",") : value;
	let i = 0;
	const len = raw.length;

	while (i < len) {
		while (i < len && (raw[i] === "," || raw[i] === " " || raw[i] === "\t"))
			i++;
		const nameStart = i;
		while (i < len && raw[i] !== "=" && raw[i] !== ",") i++;
		const name = raw.slice(nameStart, i).trim().toLowerCase();

		let directiveValue = "";
		if (raw[i] === "=") {
			i++;
			if (raw[i] === '"') {
				i++;
				const valueStart = i;
				while (i < len && raw[i] !== '"') {
					if (raw[i] === "\\") i++;
					i++;
				}
				directiveValue = raw.slice(valueStart, i);
				i++;
			} else {
				const valueStart = i;
				while (i < len && raw[i] !== ",") i++;
				directiveValue = raw.slice(valueStart, i).trim();
			}
		}

		if (name) directives.set(name, directiveValue);
	}

	return directives;
}

function parseDate(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);

	return Number.isNaN(parsed) ? null : parsed;
}

function parseSeconds(value: string | undefined): number | null {
	if (value === undefined || value === "") return null;
	// RFC 9111 delta-seconds is a non-negative integer; anything else (a float,
	// a negative, "none") is not a valid directive and must not be guessed at.
	if (!/^\d+$/.test(value.trim())) return null;

	return Number(value.trim());
}

/**
 * `Vary` headers whose request-side values Sherpa can reproduce at lookup
 * time, and which are therefore folded into the cache key.
 *
 * `accept-encoding` is listed but not keyed: the transport hands back a
 * decoded body, so an entry stored for one encoding is valid for any other.
 * Anything outside this set (`Cookie`, `User-Agent`, `Authorization`, a
 * bare `*`) means the response is not safely reusable and is not stored.
 */
export const KEYED_VARY_HEADERS = ["accept", "accept-language", "origin"];
const STORABLE_VARY_HEADERS = new Set([
	...KEYED_VARY_HEADERS,
	"accept-encoding",
]);

/** True when every `Vary` field is one this cache can key or ignore. */
export function isStorableVary(
	value: string | string[] | undefined | null
): boolean {
	if (value === undefined || value === null) return true;

	const fields = (Array.isArray(value) ? value.join(",") : value)
		.split(",")
		.map((field) => field.trim().toLowerCase())
		.filter((field) => field !== "");

	return fields.every((field) => STORABLE_VARY_HEADERS.has(field));
}

/** Heuristic freshness is capped so a stale asset can't linger for weeks. */
const HEURISTIC_CAP_SECONDS = 24 * 60 * 60;

export type StorePolicy = {
	/** Epoch ms at which the stored entry stops being fresh. */
	expiresAt: number;
	/**
	 * Whether a stale entry may still be served while a revalidation runs.
	 * `must-revalidate` forbids it; Sherpa never serves stale anyway, so this
	 * is carried for completeness and future stale-while-revalidate work.
	 */
	mustRevalidate: boolean;
};

/** Destinations that represent a navigable document. */
const DOCUMENT_DESTINATIONS = new Set(["document", "iframe"]);

/**
 * Decides whether a response may be stored, and until when.
 *
 * Returns `null` for anything that must not be reused. An entry whose
 * `expiresAt` is already in the past is still worth storing when the response
 * carries a validator: a later request revalidates it with `If-None-Match` and
 * a `304` skips both the download and the rewrite.
 *
 * @param status HTTP status of the upstream response
 * @param headers Rewritten response headers
 * @param now Current time in epoch ms
 * @param destination Fetch destination; documents skip heuristic freshness
 */
export function responseCachePolicy(
	status: number,
	headers: HeaderRecord,
	now: number,
	destination: string = ""
): StorePolicy | null {
	// Only plain `200 OK` bodies. A `206` is a fragment of a resource, a `304`
	// carries no body, and the redirect statuses are handled (and rewritten)
	// before a body is ever read.
	if (status !== 200) return null;

	// A response that sets cookies has to reach `handleResponse` so the jar and
	// the client's synchronous jar both see it. Replaying it from cache would
	// silently drop the `Set-Cookie`.
	if (headers["set-cookie"] !== undefined) return null;

	if (!isStorableVary(headers["vary"])) return null;

	// A server-sent-event body is a connection that stays open, not a resource.
	// Storing one means holding it open and buffering it for as long as it
	// lives, and replaying it later would hand the page a finished stream.
	const contentType = headerValue(headers, "content-type");
	if (contentType?.split(";")[0].trim().toLowerCase() === "text/event-stream")
		return null;

	const cc = parseCacheControl(headers["cache-control"]);
	if (cc.has("no-store")) return null;

	const etag = headerValue(headers, "etag");
	const lastModifiedHeader = headerValue(headers, "last-modified");
	const hasValidator = Boolean(etag || lastModifiedHeader);
	const mustRevalidate =
		cc.has("must-revalidate") || cc.has("proxy-revalidate");

	// `no-cache` permits storage but forbids reuse without revalidation, so it
	// is only worth anything when there is something to revalidate with.
	if (cc.has("no-cache")) {
		if (!hasValidator) return null;

		return { expiresAt: 0, mustRevalidate: true };
	}

	const date = parseDate(headerValue(headers, "date")) ?? now;
	const age = parseSeconds(headerValue(headers, "age")) ?? 0;

	let lifetime = parseSeconds(cc.get("max-age"));
	if (lifetime === null) {
		const expires = parseDate(headerValue(headers, "expires"));
		if (expires !== null) {
			lifetime = Math.max(0, (expires - date) / 1000);
		}
	}
	if (lifetime === null && !DOCUMENT_DESTINATIONS.has(destination)) {
		// RFC 9111 heuristic freshness: a tenth of the time since the resource
		// last changed. This is what browsers do for validator-only responses,
		// and it is where most real-world static-asset hits come from.
		// Documents skip it: HTML is often personalized and sent without
		// Cache-Control, and guessing a lifetime from Last-Modified would
		// replay a logged-in page into a logged-out session. Validator-only
		// storage (lifetime 0) still applies below, so a 304 can skip the
		// rewrite without ever serving stale markup.
		const lastModified = parseDate(lastModifiedHeader);
		if (lastModified !== null && lastModified <= date) {
			lifetime = Math.min(
				HEURISTIC_CAP_SECONDS,
				(date - lastModified) / 1000 / 10
			);
		}
	}
	if (lifetime === null) {
		// Nothing said how long this is good for. Store it only if it can be
		// revalidated cheaply; otherwise it is not a cache entry, it is a copy.
		if (!hasValidator) return null;
		lifetime = 0;
	}

	// Age the response by however long it already spent in upstream caches.
	const residentSeconds = age + Math.max(0, (now - date) / 1000);
	const remaining = lifetime - residentSeconds;

	if (remaining <= 0 && !hasValidator) return null;

	return {
		expiresAt: now + Math.max(0, remaining) * 1000,
		mustRevalidate,
	};
}

/**
 * Whether a request's *response* may be stored at all.
 *
 * Documents are cacheable now that the cookie jar is no longer snapshotted
 * into the rewritten HTML (`${prefix}$boot` serves a fresh dump per load).
 * Personalized pages are still refused by {@link responseCachePolicy} when
 * they set cookies, say `no-store`, or rely on heuristic freshness.
 */
export function canStoreResponseFor(
	method: string,
	_destination: string,
	requestHeaders: { has(name: string): boolean }
): boolean {
	if (method !== "GET") return false;
	// A range request yields a partial body, and a conditional request is the
	// page running its own cache protocol - stay out of both.
	if (
		requestHeaders.has("range") ||
		requestHeaders.has("if-none-match") ||
		requestHeaders.has("if-modified-since") ||
		requestHeaders.has("if-range")
	)
		return false;
	// A private cache may hold authorized responses, but the key deliberately
	// does not include credentials, so an entry stored for one bearer token
	// could be served to a request carrying another. Skip them.
	if (requestHeaders.has("authorization")) return false;

	return true;
}

/**
 * Whether a stored entry may be *used*, given the request's own cache mode
 * and directives. `no-store`/`reload`/`no-cache` all mean "go to the network".
 */
export function canUseStoredResponse(
	requestCache: RequestCache | undefined,
	requestHeaders: { get(name: string): string | null }
): boolean {
	if (
		requestCache === "no-store" ||
		requestCache === "reload" ||
		requestCache === "no-cache"
	)
		return false;

	const cc = parseCacheControl(requestHeaders.get("cache-control"));
	if (cc.has("no-store") || cc.has("no-cache")) return false;
	if ((requestHeaders.get("pragma") || "").toLowerCase().includes("no-cache"))
		return false;

	const maxAge = parseSeconds(cc.get("max-age"));
	if (maxAge === 0) return false;

	return true;
}

/**
 * FNV-1a, 32-bit. Used to fold the cache-key inputs and the active
 * configuration into short, stable tokens. Not a security primitive - it only
 * has to be deterministic and cheap enough to run on every proxied request.
 */
export function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return hash.toString(16).padStart(8, "0");
}

/**
 * The rewritten output for one URL depends on more than the URL: a script and
 * a stylesheet at the same address rewrite differently, a module and a classic
 * script parse differently, and a response may legitimately `Vary`. All of it
 * is folded into one token so a variant can never be served in place of
 * another.
 */
export function cacheVariantToken(
	destination: string,
	scriptType: string,
	varyValues: readonly (string | null | undefined)[]
): string {
	return fnv1a(
		[destination, scriptType, ...varyValues.map((value) => value ?? "")].join(
			" "
		)
	);
}

/**
 * Query parameter carrying the variant token on a cache key URL.
 *
 * Spelled out rather than built from `INTERNAL_PARAM_PREFIX` so this module
 * keeps zero imports and stays loadable on its own; `tests/unit/httpCache`
 * pins it to the shared namespace.
 */
export const CACHE_KEY_PARAM = "scramjet.cache";

/**
 * Builds the key a variant is stored under: the real upstream URL (so the
 * bucket stays legible when debugging) plus the variant token.
 *
 * The key is never fetched and never leaves the cache, so the appended
 * parameter cannot reach the site. All relevant variance lives in the URL,
 * which means the key `Request` needs no headers of its own and the Cache
 * API's `Vary` matching has nothing left to do.
 */
export function cacheKeyUrl(
	url: URL,
	destination: string,
	scriptType: string,
	getRequestHeader: (name: string) => string | null
): string {
	const token = cacheVariantToken(
		destination,
		scriptType,
		KEYED_VARY_HEADERS.map(getRequestHeader)
	);
	const key = new URL(url.href);
	key.searchParams.set(CACHE_KEY_PARAM, token);

	return key.href;
}
