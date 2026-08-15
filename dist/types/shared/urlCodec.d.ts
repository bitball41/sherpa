export type UrlCodec = (value: string) => string;
/**
 * Removes Sherpa's own query parameters from a decoded URL.
 *
 * The hints Sherpa threads through the query string (`sherpa.type`,
 * `sherpa.dest`, ...) are stripped before the upstream request, but they were
 * still part of what the *page* saw when it read a URL back: a worker's
 * `self.location.href` came out as `.../worker.js?sherpa.dest=worker`, and a
 * module's `import.meta.url` carried `?sherpa.type=module`. Any site that
 * parses its own query string - workers configured by search params are the
 * usual case - saw a parameter it never set.
 */
export declare function stripInternalParams(url: string): string;
/**
 * Encodes an HTTP(S) URL behind a proxy prefix without mutating the URL.
 * The fragment is encoded separately so it remains a browser-visible hash
 * instead of being sent to the service worker.
 */
export declare function encodeProxyUrl(url: URL, prefix: string, encode: UrlCodec, serialized?: string): string;
/**
 * Decodes a URL that starts with the supplied proxy prefix. Non-proxy URLs
 * are returned unchanged, making this safe for page-facing URL getters.
 */
export declare function decodeProxyUrl(url: string, proxyPrefix: string, decode: UrlCodec): string;
/**
 * Resolves an HTML <base href> against the document's fallback base URL.
 * Relative bases are directory-relative to the response URL, not origin-rooted.
 */
export declare function resolveBaseHref(href: string, fallbackBase: URL): URL | null;
export declare function appendUrlParamEntries(url: URL, params: Iterable<readonly [string, string]>): void;
/**
 * Adds Sherpa's internal query parameters before a URL fragment. Concatenating
 * `?dest=...` directly put the parameter inside `#fragment`, where service
 * workers cannot see it.
 */
export declare function appendUrlParams(url: string, params: Record<string, string | undefined>): string;
