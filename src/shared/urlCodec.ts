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
export function appendUrlParams(
	url: string,
	params: Record<string, string | undefined>
): string {
	const hashIndex = url.indexOf("#");
	const head = hashIndex === -1 ? url : url.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
	const serialized = new URLSearchParams();

	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) serialized.set(key, value);
	}

	const query = serialized.toString();
	if (!query) return url;

	return `${head}${head.includes("?") ? "&" : "?"}${query}${hash}`;
}

/**
 * Tests whether a same-origin request belongs to Sherpa's encoded URL prefix
 * or is the exact configured rewriter WASM path.
 */
export function matchesSherpaRoute(
	requestUrl: string,
	proxyOrigin: string,
	proxyPrefix: string,
	wasmPath: string
): boolean {
	try {
		const origin = new URL(proxyOrigin).origin;
		const request = new URL(requestUrl);
		if (request.origin !== origin) return false;

		const proxy = new URL(proxyPrefix, `${origin}/`);
		const wasm = new URL(wasmPath, `${origin}/`);

		return (
			(proxy.origin === origin && request.href.startsWith(proxy.href)) ||
			(wasm.origin === origin && request.pathname === wasm.pathname)
		);
	} catch {
		return false;
	}
}

/**
 * Performs Web IDL's string conversion for URL-bearing DOM arguments.
 * Symbols are rejected instead of being accepted by JavaScript's String()
 * convenience special case.
 */
export function toWebIdlString(value: unknown): string {
	if (typeof value === "symbol") {
		throw new TypeError("Cannot convert a Symbol value to a string");
	}

	return String(value);
}

/**
 * Converts History's optional nullable URL argument. Both an omitted value and
 * explicit undefined use the Web IDL null default.
 */
export function normalizeHistoryUrl(value: unknown): string | null {
	if (value === null || value === undefined) return null;

	return toWebIdlString(value);
}
