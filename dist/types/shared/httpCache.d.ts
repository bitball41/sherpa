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
/**
 * Splits a `Cache-Control` value into its directives.
 *
 * Directive names are case-insensitive and values may be quoted
 * (`no-cache="set-cookie"`), so neither a `split(",")` nor a regex over the
 * raw string is safe - a comma inside a quoted value would split a directive
 * in half.
 */
export declare function parseCacheControl(value: string | string[] | undefined | null): Map<string, string>;
/**
 * `Vary` headers whose request-side values Sherpa can reproduce at lookup
 * time, and which are therefore folded into the cache key.
 *
 * `accept-encoding` is listed but not keyed: the transport hands back a
 * decoded body, so an entry stored for one encoding is valid for any other.
 * Anything outside this set (`Cookie`, `User-Agent`, `Authorization`, a
 * bare `*`) means the response is not safely reusable and is not stored.
 */
export declare const KEYED_VARY_HEADERS: string[];
/** True when every `Vary` field is one this cache can key or ignore. */
export declare function isStorableVary(value: string | string[] | undefined | null): boolean;
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
export declare function responseCachePolicy(status: number, headers: HeaderRecord, now: number, destination?: string): StorePolicy | null;
/**
 * Whether a request's *response* may be stored at all.
 *
 * Documents are cacheable now that the cookie jar is no longer snapshotted
 * into the rewritten HTML (`${prefix}$boot` serves a fresh dump per load).
 * Personalized pages are still refused by {@link responseCachePolicy} when
 * they set cookies, say `no-store`, or rely on heuristic freshness.
 */
export declare function canStoreResponseFor(method: string, _destination: string, requestHeaders: {
    has(name: string): boolean;
}): boolean;
/**
 * Whether a stored entry may be *used*, given the request's own cache mode
 * and directives. `no-store`/`reload`/`no-cache` all mean "go to the network".
 */
export declare function canUseStoredResponse(requestCache: RequestCache | undefined, requestHeaders: {
    get(name: string): string | null;
}): boolean;
/**
 * FNV-1a, 32-bit. Used to fold the cache-key inputs and the active
 * configuration into short, stable tokens. Not a security primitive - it only
 * has to be deterministic and cheap enough to run on every proxied request.
 */
export declare function fnv1a(input: string): string;
/**
 * The rewritten output for one URL depends on more than the URL: a script and
 * a stylesheet at the same address rewrite differently, a module and a classic
 * script parse differently, and a response may legitimately `Vary`. All of it
 * is folded into one token so a variant can never be served in place of
 * another.
 */
export declare function cacheVariantToken(destination: string, scriptType: string, varyValues: readonly (string | null | undefined)[]): string;
/**
 * Query parameter carrying the variant token on a cache key URL.
 *
 * Spelled out rather than built from `INTERNAL_PARAM_PREFIX` so this module
 * keeps zero imports and stays loadable on its own; `tests/unit/httpCache`
 * pins it to the shared namespace.
 */
export declare const CACHE_KEY_PARAM = "sherpa.cache";
/**
 * Builds the key a variant is stored under: the real upstream URL (so the
 * bucket stays legible when debugging) plus the variant token.
 *
 * The key is never fetched and never leaves the cache, so the appended
 * parameter cannot reach the site. All relevant variance lives in the URL,
 * which means the key `Request` needs no headers of its own and the Cache
 * API's `Vary` matching has nothing left to do.
 */
export declare function cacheKeyUrl(url: URL, destination: string, scriptType: string, getRequestHeader: (name: string) => string | null): string;
