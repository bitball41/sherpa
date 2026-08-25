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

export const INTERNAL_PARAMS = {
	/** `"module"` for module scripts/workers, so the rewriter picks the right parse goal. */
	type: `${INTERNAL_PARAM_PREFIX}type`,
	/** The real request destination for contexts the browser reports as `"empty"`. */
	dest: `${INTERNAL_PARAM_PREFIX}dest`,
	/** A registered service worker's scope path. */
	scope: `${INTERNAL_PARAM_PREFIX}scope`,
	/** Marks a request issued by Sherpa's emulated service-worker runtime. */
	from: `${INTERNAL_PARAM_PREFIX}from`,
	/** Frame names used to emulate `_top` / `_parent` targeting. */
	topFrame: `${INTERNAL_PARAM_PREFIX}topFrame`,
	parentFrame: `${INTERNAL_PARAM_PREFIX}parentFrame`,
	/** The virtual document URL, threaded through `${prefix}$boot`. */
	url: `${INTERNAL_PARAM_PREFIX}url`,
} as const;

/** True for query parameters that belong to Sherpa rather than to the site. */
export function isInternalParam(name: string): boolean {
	return name.startsWith(INTERNAL_PARAM_PREFIX);
}

/**
 * True for a query pair the worker/client should consume rather than forward.
 *
 * The committed WASM rewriter still appends the pre-namespace `type=module`
 * token (`rewriter/wasm/src/jsr.rs`); that exact pair is ours. Any other
 * `type=` value is the site's.
 */
export function isInternalQueryParam(name: string, value = ""): boolean {
	if (name.startsWith(INTERNAL_PARAM_PREFIX)) return true;
	return name === "type" && value === "module";
}

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
export function takeInternalParams(url: URL): SherpaRequestHints {
	const hints: SherpaRequestHints = {
		scriptType: "",
		fromServiceWorkerRuntime: false,
		siteParams: [],
	};

	// Most proxied requests carry no query at all - the target is encoded into
	// the path - and this runs on every one of them. Reading `searchParams`
	// materializes a `URLSearchParams` for the URL, and the spread below
	// allocates an array of every entry in it; neither is worth doing to
	// discover there was nothing there.
	if (url.search === "") return hints;

	for (const [param, value] of [...url.searchParams.entries()]) {
		switch (param) {
			case INTERNAL_PARAMS.type:
				hints.scriptType = value;
				break;
			case "type":
				if (value === "module") hints.scriptType = value;
				else hints.siteParams.push([param, value]);
				break;
			case INTERNAL_PARAMS.dest:
			case INTERNAL_PARAMS.scope:
				break;
			case INTERNAL_PARAMS.from:
				hints.fromServiceWorkerRuntime = value === "swruntime";
				break;
			case INTERNAL_PARAMS.topFrame:
				hints.topFrameName = value;
				break;
			case INTERNAL_PARAMS.parentFrame:
				hints.parentFrameName = value;
				break;
			case INTERNAL_PARAMS.url:
				break;
			default:
				if (!isInternalParam(param)) hints.siteParams.push([param, value]);
				break;
		}
		url.searchParams.delete(param);
	}

	return hints;
}
