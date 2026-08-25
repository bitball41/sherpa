import { INTERNAL_PARAM_PREFIX } from "@/shared/internalParams";

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
export function stripInternalParams(url: string): string {
	// The overwhelming majority of URLs carry none of these, and this runs on
	// every unrewrite; reject on a substring scan before doing any parsing.
	if (url.indexOf(INTERNAL_PARAM_PREFIX) === -1) return url;

	const queryIndex = url.indexOf("?");
	if (queryIndex === -1) return url;

	const hashIndex = url.indexOf("#", queryIndex);
	const query = url.slice(
		queryIndex + 1,
		hashIndex === -1 ? undefined : hashIndex
	);
	if (query.indexOf(INTERNAL_PARAM_PREFIX) === -1) return url;

	// The prefix ends in `.`, which `URLSearchParams` serialization leaves
	// as-is, so the raw parameter name can be tested without decoding it.
	const kept: string[] = [];
	let removed = false;
	for (const pair of query.split("&")) {
		if (pair === "") continue;
		const equals = pair.indexOf("=");
		const name = equals === -1 ? pair : pair.slice(0, equals);
		if (name.startsWith(INTERNAL_PARAM_PREFIX)) removed = true;
		else kept.push(pair);
	}
	if (!removed) return url;

	const head = url.slice(0, queryIndex);
	const hash = hashIndex === -1 ? "" : url.slice(hashIndex);

	return kept.length ? `${head}?${kept.join("&")}${hash}` : head + hash;
}

/**
 * Encodes an HTTP(S) URL behind a proxy prefix without mutating the URL.
 * The fragment is encoded separately so it remains a browser-visible hash
 * instead of being sent to the service worker.
 */
export function encodeProxyUrl(
	url: URL,
	prefix: string,
	encode: UrlCodec,
	// `URL.prototype.href` re-serializes the URL on every read, and this runs
	// for every URL on a page. Callers that already hold the serialization pass
	// it in rather than paying for a second one.
	serialized?: string
): string {
	const href = serialized ?? url.href;
	if (url.protocol !== "http:" && url.protocol !== "https:") return href;

	const hashIndex = href.indexOf("#");
	if (hashIndex === -1) return prefix + encode(href);

	const encodedHash = encode(href.slice(hashIndex + 1));
	const hash = encodedHash ? `#${encodedHash}` : "";

	return prefix + encode(href.slice(0, hashIndex)) + hash;
}

/** Replaces a URL's query with `query`, dropping it entirely when empty. */
function withQuery(url: string, query: string): string {
	const questionMark = url.indexOf("?");
	const head = questionMark === -1 ? url : url.slice(0, questionMark);

	return query ? `${head}?${query}` : head;
}

/**
 * Decodes the target out of one encoded proxy path segment.
 *
 * The target is encoded, but a query can still be appended to the proxied URL
 * *after* it in cleartext - that is how a GET form submits, since the browser
 * mutates the query of the action URL it was handed. Per HTML that query
 * *replaces* the action URL's own, so the decoded target's query is dropped
 * rather than kept alongside it: a search box on a page whose URL already
 * carried `?q=` otherwise read back `?q=old?q=new`, which is not even a query
 * string the site could parse.
 */
function decodeProxyTarget(encoded: string, decode: UrlCodec): string {
	// Sherpa's own hints are appended the same way, so they come off first -
	// the same place and the same way the service worker takes them off an
	// incoming request, and independent of what the configured codec does to
	// a `?`.
	const withoutHints = stripInternalParams(encoded);
	const questionMark = withoutHints.indexOf("?");
	if (questionMark === -1) return decode(withoutHints);

	return withQuery(
		decode(withoutHints.slice(0, questionMark)),
		withoutHints.slice(questionMark + 1)
	);
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
  // Blob/data targets are carried through the prefix verbatim, but the
  // runtime can still append Sherpa's internal hints to the proxied URL.
  // Remove those hints before exposing the URL back to the page.
  if (/^(?:blob|data):/i.test(encoded)) return stripInternalParams(encoded);

	const hashIndex = encoded.indexOf("#");
	if (hashIndex === -1) return decodeProxyTarget(encoded, decode);

	const decodedUrl = decodeProxyTarget(encoded.slice(0, hashIndex), decode);
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
