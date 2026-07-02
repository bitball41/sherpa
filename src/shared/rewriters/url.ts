import { codecDecode, codecEncode } from "@/shared";
import { config } from "@/shared";
import { rewriteJs } from "@rewriters/js";

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

	// every special-cased scheme starts with j/b/d/m/a - gate the startsWith
	// chain on the first character so the dominant http(s)/relative case
	// skips it entirely
	const first = url.charCodeAt(0);
	if (
		first === 106 /* j */ ||
		first === 98 /* b */ ||
		first === 100 /* d */ ||
		first === 109 /* m */ ||
		first === 97 /* a */
	) {
		if (url.startsWith("javascript:")) {
			return (
				"javascript:" +
				rewriteJs(url.slice("javascript:".length), "(javascript: url)", meta)
			);
		} else if (url.startsWith("blob:") || url.startsWith("data:")) {
			return proxyBase() + url;
		} else if (url.startsWith("mailto:") || url.startsWith("about:")) {
			return url;
		}
	}

	let base = meta.base.href;

	if (base.startsWith("about:")) base = unrewriteUrl(self.location.href); // jank!!!!! weird jank!!!
	const realUrl = tryCanParseURL(url, base);
	if (!realUrl) return url;

	// Only http(s) URLs are ever proxied. If this resolved to some other
	// scheme (tel:, sms:, intent:, magnet:, ftp:, ws:, ...) it's handled by
	// the browser or an external app, so pass it through untouched instead
	// of mangling it into a proxied URL. Mirrors SherpaController.encodeUrl.
	if (realUrl.protocol !== "http:" && realUrl.protocol !== "https:") {
		return url;
	}

	// the fragment (if any) is codec-encoded separately from the rest of the
	// URL; slicing href avoids the extra serialization the hash setter costs
	const href = realUrl.href;
	const hashIndex = href.indexOf("#");
	if (hashIndex === -1) return proxyBase() + codecEncode(href);

	const encodedHash = codecEncode(href.slice(hashIndex + 1));
	const realHash = encodedHash ? "#" + encodedHash : "";

	return proxyBase() + codecEncode(href.slice(0, hashIndex)) + realHash;
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

	const rest = url.substring(prefixed.length);
	if (rest.startsWith("blob:") || rest.startsWith("data:")) return rest;

	const realUrl = tryCanParseURL(url);
	if (!realUrl) return url;

	// slicing href instead of clearing realUrl.hash skips both the hash
	// setter's re-serialization and a codecDecode of the empty string on the
	// (dominant) fragment-less case
	const href = realUrl.href;
	const hashIndex = href.indexOf("#");
	if (hashIndex === -1) return codecDecode(href.slice(prefixed.length));

	const decodedHash = codecDecode(href.slice(hashIndex + 1));
	const realHash = decodedHash ? "#" + decodedHash : "";

	return codecDecode(href.slice(prefixed.length, hashIndex) + realHash);
}
