import { codecDecode, codecEncode } from "@/shared";
import { config } from "@/shared";
import { rewriteJs } from "@rewriters/js";
import { decodeProxyUrl, encodeProxyUrl } from "@/shared/urlCodec";
import { snapshotMeta, type URLMeta } from "@/shared/urlMeta";

export type { URLMeta };
export { snapshotMeta };

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

	return "blob:" + proxyOrigin() + blob.pathname;
}

// The physical origin Sherpa is served from, as this realm sees it.
//
// Normally that is just `location.origin`. An `about:srcdoc` (and a sandboxed)
// document has an *opaque* URL, though, so `location.origin` there is the
// literal string `"null"` - even while the document runs on the proxy's real
// origin and every URL in it is a proxied one. Every rewrite and unrewrite in
// such a realm was therefore built against `"null/prefix/"`: nothing matched
// the proxy prefix on the way back, so a page reading `img.src` inside an
// `<iframe srcdoc>` got the raw proxied URL, and anything it rewrote came out
// pointing at a host called `null`.
//
// A frame with an opaque URL still shares its creator's physical origin, so
// the answer is one step up the frame tree.
let cachedOrigin: string | null = null;

export function proxyOrigin(): string {
	if (cachedOrigin !== null) return cachedOrigin;

	const own = location.origin;
	if (own && own !== "null") return (cachedOrigin = own);

	if ("window" in globalThis) {
		try {
			let win = globalThis as typeof globalThis & Window;
			// bounded: a frame tree deeper than this is not a real page
			for (let depth = 0; depth < 64; depth++) {
				const up = win.parent as typeof win;
				if (!up || up === win) break;
				win = up;
				const origin = win.location.origin;
				if (origin && origin !== "null") return (cachedOrigin = origin);
			}
		} catch {
			// A real cross-origin ancestor throws; there is nothing to inherit.
		}
	}

	// Cached even when it failed. Neither a realm's own URL nor its ancestry
	// changes once it exists, so the answer cannot improve - and this runs for
	// every URL the realm rewrites, where re-walking the frame tree (and
	// re-throwing on a cross-origin ancestor) per URL would be its own problem.
	return (cachedOrigin = own);
}

// `proxyOrigin() + config.prefix` is prepended to every rewritten URL; rebuild
// it only when the prefix actually changes instead of concatenating on every
// call.
let cachedProxyBase = "";
let cachedProxyBasePrefix: string | null = null;
let cachedProxyBaseOrigin: string | null = null;

function proxyBase(): string {
	const prefix = config.prefix;
	const origin = proxyOrigin();
	if (cachedProxyBasePrefix !== prefix || cachedProxyBaseOrigin !== origin) {
		cachedProxyBasePrefix = prefix;
		cachedProxyBaseOrigin = origin;
		cachedProxyBase = origin + prefix;
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

	const prefixed = proxyBase();
	const href = realUrl.href;

	// Rewriting is idempotent. A page hands Sherpa an already-proxied URL more
	// often than it looks: any DOM stringifier reads the *attribute* rather
	// than the trapped JS property, so `String(anchor)`, `${anchorElement}` and
	// `fetch(anchor)` all produce the rewritten href. Encoding that a second
	// time produced a URL whose inner target was the proxy itself, which the
	// service worker then rejected as a same-origin fetch - the request failed
	// outright instead of being served.
	if (href.startsWith(prefixed)) return href;

	return encodeProxyUrl(realUrl, prefixed, codecEncode, href);
}

export function unrewriteUrl(url: string | URL, stripHints = true) {
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

	return decodeProxyUrl(url, prefixed, codecDecode, stripHints);
}
