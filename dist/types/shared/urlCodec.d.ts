export type UrlCodec = (value: string) => string;
/**
 * Encodes an HTTP(S) URL behind a proxy prefix without mutating the URL.
 * The fragment is encoded separately so it remains a browser-visible hash
 * instead of being sent to the service worker.
 */
export declare function encodeProxyUrl(url: URL, prefix: string, encode: UrlCodec): string;
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
export type ExtractedUrlParams = {
    url: string;
    params: Record<string, string> | null;
};
/**
 * Adds a marked Sherpa metadata suffix before the fragment. Individual legacy
 * parameters remain after the marker so an older worker can still understand
 * the URL during a service-worker update race.
 */
export declare function appendUrlParams(url: string, params: Record<string, string | undefined>): string;
/**
 * Removes only Sherpa's marked suffix, preserving every byte of the encoded
 * target URL before it. This prevents target query names such as `type`,
 * `scope`, or `from` from becoming internal controls under custom codecs.
 */
export declare function extractUrlParams(url: string): ExtractedUrlParams;
