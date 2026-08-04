/**
 * Storage glue for Sherpa's rewritten-response cache.
 *
 * The policy rules live in `@/shared/httpCache`; this file owns the
 * `CacheStorage` bucket, the key layout, and the read/write/evict paths the
 * service worker's fetch handler calls into.
 *
 * What is stored is the *rewritten* response, not the upstream bytes, so a hit
 * skips the transport **and** the oxc/htmlparser2 rewrite - which on repeat
 * visits is most of what a proxied page costs.
 */
import { type HeaderRecord, type StorePolicy } from "../shared/httpCache";
export { cacheKeyUrl } from "../shared/httpCache";
export type CachedEntry = {
    /** The stored rewritten response, ready to serve. */
    response: Response;
    /** False when the entry needs revalidating before it can be used. */
    fresh: boolean;
    etag: string | null;
    lastModified: string | null;
};
/**
 * Looks a variant up. Returns `null` when there is nothing usable; a stale
 * entry comes back with `fresh: false` and its validators, so the caller can
 * turn the upstream request into a conditional one.
 */
export declare function lookupCachedResponse(keyUrl: string, now: number): Promise<CachedEntry | null>;
/**
 * Stores a rewritten response under an already-approved {@link StorePolicy}.
 *
 * Takes a *clone* - the caller keeps the original for the page - and is only
 * ever called once the policy said yes, so a rejected response never leaves an
 * unread tee behind. Failures are swallowed: a full quota or a torn-down
 * worker must not turn into a failed page load.
 */
export declare function storeCachedResponse(keyUrl: string, policy: StorePolicy, response: Response, now: number): Promise<void>;
/**
 * Serves a revalidated entry after a `304`, refreshing its freshness window.
 * Upstream may restate headers alongside the `304`; those win over the stored
 * copy's.
 */
export declare function refreshCachedResponse(keyUrl: string, entry: CachedEntry, responseHeaders: HeaderRecord, now: number): Promise<Response>;
/** Drops every stored response. Exposed for cache-busting and for tests. */
export declare function clearResponseCache(): Promise<void>;
