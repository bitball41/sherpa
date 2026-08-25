/**
 * Sherpa threads a few internal hints - a script's module-ness, a request's
 * real destination, a service worker's registered scope - through the query
 * string of the URLs it hands the browser, because that is the only channel
 * that survives into the service worker's `FetchEvent`.
 *
 * Those hints used to travel under bare names (`type`, `dest`, `scope`,
 * `from`, `topFrame`, `parentFrame`), which sites use for their own query
 * parameters all the time. Anything a page appended to a proxied URL under
 * one of those names - a GET form with a `type` select, a date filter named
 * `from`, a `?scope=` link - was consumed by the worker as a Sherpa hint and
 * never reached the upstream site, and a page URL that happened to carry
 * `?dest=serviceworker` made the client boot as an emulated service worker.
 *
 * Namespacing them removes the collision: everything under this prefix
 * belongs to Sherpa and is stripped before the upstream request, everything
 * else is the site's and is passed through untouched. The prefix uses `.`
 * rather than `$` or `_` so `URLSearchParams` serialization leaves it
 * readable instead of percent-encoding it.
 */
import { INTERNAL_PARAM_PREFIX } from "./pageSurface";
export { INTERNAL_PARAM_PREFIX };
export declare const INTERNAL_PARAMS: {
    /** `"module"` for module scripts/workers, so the rewriter picks the right parse goal. */
    readonly type: "scramjet.type";
    /** The real request destination for contexts the browser reports as `"empty"`. */
    readonly dest: "scramjet.dest";
    /** A registered service worker's scope path. */
    readonly scope: "scramjet.scope";
    /** Marks a request issued by Sherpa's emulated service-worker runtime. */
    readonly from: "scramjet.from";
    /** Frame names used to emulate `_top` / `_parent` targeting. */
    readonly topFrame: "scramjet.topFrame";
    readonly parentFrame: "scramjet.parentFrame";
    /** The virtual document URL, threaded through `${prefix}$boot`. */
    readonly url: "scramjet.url";
};
/** True for query parameters that belong to Sherpa rather than to the site. */
export declare function isInternalParam(name: string): boolean;
/**
 * True for a query pair the worker/client should consume rather than forward.
 *
 * The committed WASM rewriter still appends the pre-namespace `type=module`
 * token (`rewriter/wasm/src/jsr.rs`); that exact pair is ours. Any other
 * `type=` value is the site's.
 */
export declare function isInternalQueryParam(name: string, value?: string): boolean;
export type SherpaRequestHints = {
    /** `"module"` when the request is for a module script/worker. */
    scriptType: string;
    topFrameName?: string;
    parentFrameName?: string;
    fromServiceWorkerRuntime: boolean;
    /**
     * Query parameters that belong to the site - most often a GET form's
     * fields, which the browser appended to the proxied action URL. The caller
     * re-attaches these to the decoded upstream URL.
     */
    siteParams: Array<[string, string]>;
};
/**
 * Reads Sherpa's hints out of a proxied request URL and strips *every* query
 * parameter from it, since the upstream URL is encoded into the path and a
 * leftover query would corrupt decoding. Parameters that aren't Sherpa's are
 * handed back so they can be re-attached to the decoded URL.
 */
export declare function takeInternalParams(url: URL): SherpaRequestHints;
