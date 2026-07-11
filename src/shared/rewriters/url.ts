import { codecDecode, codecEncode } from "@/shared";
import { config } from "@/shared";
import { rewriteJs } from "@rewriters/js";
import { decodeProxyUrl, encodeProxyUrl } from "@/shared/urlCodec";

export type URLMeta = {
	origin: URL;
	base: URL;
	topFrameName?: string;
	parentFrameName?: string;
};

function tryCanParseURL(url: string, origin?: string | URL): URL | null {
	try {
		return new URL(url, origin);
	} catch {
		return null;
	}
}

export function rewriteBlob(url: string, meta: URLMeta) {
	const blob = new URL(url.substring("blob:".length));

	return "blob:" + meta.origin.origin + blob.pathname;
}

export function unrewriteBlob(url: string) {
	const blob = new URL(url.substring("blob:".length));

	return "blob:" + location.origin + blob.pathname;
}

// `location.origin + config.prefix` is prepended to every rewritten URL;
// rebuild it only when the prefix actually changes instead of concatenating
// on every call. A realm's location.origin can never change, so it isn't
// re-read (the getter allocates a fresh string per read).
let cachedProxyBase = "";
let cachedProxyBasePrefix: string | null = null;

function proxyBase(): string {
	const prefix = config.prefix;
	if (cachedProxyBasePrefix !== prefix) {
		cachedProxyBasePrefix = prefix;
		cachedProxyBase = location.origin + prefix;
	}

	return cachedProxyBase;
}

export function rewriteUrl(url: string | URL, meta: URLMeta) {
	if (url instanceof URL) url = url.toString();

	let base = meta.base.href;

	if (base.startsWith("about:")) base = unrewriteUrl(self.location.href); // jank!!!!! weird jank!!!
	const realUrl = tryCanParseURL(url, base);
	if (!realUrl) return url;

	// URL schemes are ASCII case-insensitive, and the URL parser also accepts
	// surrounding C0 whitespace. Branch on the parsed protocol so variants like
	// `JavaScript:` cannot bypass rewriting.
	if (realUrl.protocol === "javascript:") {
		const colonIndex = url.indexOf(":");
		const source = colonIndex === -1 ? "" : url.slice(colonIndex + 1);

		return "javascript:" + rewriteJs(source, "(javascript: url)", meta);
	}
	if (realUrl.protocol === "blob:" || realUrl.protocol === "data:") {
		return proxyBase() + realUrl.href;
	}
	if (realUrl.protocol === "mailto:" || realUrl.protocol === "about:") {
		return url;
	}

	// Only http(s) URLs are ever proxied. If this resolved to some other
	// scheme (tel:, sms:, intent:, magnet:, ftp:, ws:, ...) it's handled by
	// the browser or an external app, so pass it through untouched instead
	// of mangling it into a proxied URL. Mirrors SherpaController.encodeUrl.
	if (realUrl.protocol !== "http:" && realUrl.protocol !== "https:") {
		return url;
	}

	return encodeProxyUrl(realUrl, proxyBase(), codecEncode);
}

export function unrewriteUrl(url: string | URL) {
	if (url instanceof URL) url = url.toString();
	// remove query string
	// if (url.includes("?")) {
	// 	url = url.split("?")[0];
	// }

	const prefixed = proxyBase();

	// If this isn't one of our proxied URLs there's nothing to decode - e.g.
	// a javascript:/blob:/mailto:/about: URL, an external-scheme URL (tel:,
	// magnet:, ...) that rewriteUrl passed through, or an already-bare URL.
	// Returning it untouched avoids slicing off a prefix that isn't there
	// and producing garbage. (javascript: unrewriting is still a TODO - the
	// js rewrite isn't losslessly reversible.)
	if (!url.startsWith(prefixed)) return url;

	return decodeProxyUrl(url, prefixed, codecDecode);
}
