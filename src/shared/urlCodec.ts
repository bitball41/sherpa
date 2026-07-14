export type UrlCodec = (value: string) => string;

/**
 * Encodes an HTTP(S) URL behind a proxy prefix without mutating the URL.
 * The fragment is encoded separately so it remains a browser-visible hash
 * instead of being sent to the service worker.
 */
export function encodeProxyUrl(
	url: URL,
	prefix: string,
	encode: UrlCodec
): string {
	if (url.protocol !== "http:" && url.protocol !== "https:") return url.href;

	const href = url.href;
	const hashIndex = href.indexOf("#");
	if (hashIndex === -1) return prefix + encode(href);

	const encodedHash = encode(href.slice(hashIndex + 1));
	const hash = encodedHash ? `#${encodedHash}` : "";

	return prefix + encode(href.slice(0, hashIndex)) + hash;
}

/**
 * Decodes a URL that starts with the supplied proxy prefix. Non-proxy URLs
 * are returned unchanged, making this safe for page-facing URL getters.
 */
export function decodeProxyUrl(
	url: string,
	proxyPrefix: string,
	decode: UrlCodec
): string {
	if (!url.startsWith(proxyPrefix)) return url;

	const encoded = url.slice(proxyPrefix.length);
	if (/^(?:blob|data):/i.test(encoded)) return encoded;

	const hashIndex = encoded.indexOf("#");
	if (hashIndex === -1) return decode(encoded);

	const decodedUrl = decode(encoded.slice(0, hashIndex));
	const decodedHash = decode(encoded.slice(hashIndex + 1));

	return decodedUrl + (decodedHash ? `#${decodedHash}` : "");
}

/**
 * Resolves an HTML <base href> against the document's fallback base URL.
 * Relative bases are directory-relative to the response URL, not origin-rooted.
 */
export function resolveBaseHref(href: string, fallbackBase: URL): URL | null {
	try {
		return new URL(href, fallbackBase);
	} catch {
		return null;
	}
}

export function appendUrlParamEntries(
	url: URL,
	params: Iterable<readonly [string, string]>
): void {
	for (const [name, value] of params) {
		url.searchParams.append(name, value);
	}
}

/**
 * Adds Sherpa's internal query parameters before a URL fragment. Concatenating
 * `?dest=...` directly put the parameter inside `#fragment`, where service
 * workers cannot see it.
 */
const INTERNAL_METADATA_PARAM = "__sherpa_meta__";

export type ExtractedUrlParams = {
	url: string;
	params: Record<string, string> | null;
};

/**
 * Adds a marked Sherpa metadata suffix before the fragment. Individual legacy
 * parameters remain after the marker so an older worker can still understand
 * the URL during a service-worker update race.
 */
export function appendUrlParams(
	url: string,
	params: Record<string, string | undefined>
): string {
	const entries = Object.entries(params).filter(
		(entry): entry is [string, string] => entry[1] !== undefined
	);
	if (entries.length === 0) return url;

	const hashIndex = url.indexOf("#");
	const head = hashIndex === -1 ? url : url.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
	const serialized = new URLSearchParams();
	serialized.set(INTERNAL_METADATA_PARAM, JSON.stringify(entries));
	for (const [name, value] of entries) serialized.append(name, value);

	return `${head}${head.includes("?") ? "&" : "?"}${serialized}${hash}`;
}

/**
 * Removes only Sherpa's marked suffix, preserving every byte of the encoded
 * target URL before it. This prevents target query names such as `type`,
 * `scope`, or `from` from becoming internal controls under custom codecs.
 */
export function extractUrlParams(url: string): ExtractedUrlParams {
	const hashIndex = url.indexOf("#");
	const head = hashIndex === -1 ? url : url.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
	const questionMarker = `?${INTERNAL_METADATA_PARAM}=`;
	const ampersandMarker = `&${INTERNAL_METADATA_PARAM}=`;
	const markerIndex = Math.max(
		head.lastIndexOf(questionMarker),
		head.lastIndexOf(ampersandMarker)
	);
	if (markerIndex === -1) return { url, params: null };

	const suffix = head.slice(markerIndex + 1);
	const encoded = new URLSearchParams(suffix).get(INTERNAL_METADATA_PARAM);
	if (encoded === null) return { url, params: null };

	try {
		const entries: unknown = JSON.parse(encoded);
		if (!Array.isArray(entries)) return { url, params: null };
		const params = Object.create(null) as Record<string, string>;
		for (const entry of entries) {
			if (
				!Array.isArray(entry) ||
				entry.length !== 2 ||
				typeof entry[0] !== "string" ||
				typeof entry[1] !== "string"
			) {
				return { url, params: null };
			}
			params[entry[0]] = entry[1];
		}

		return { url: head.slice(0, markerIndex) + hash, params };
	} catch {
		return { url, params: null };
	}
}
