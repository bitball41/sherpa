/**
 * The three parser-blocking boot scripts every proxied document (and srcdoc
 * frame) loads before page content runs.
 *
 * Used to be: a ~695 KiB classic script that assigned `self.WASM` to a base64
 * literal of the rewriter, the runtime bundle, and an inline data: script that
 * snapshotted the cookie jar plus the whole configuration. Two of those were
 * load-bearing problems:
 *
 *   1. The renderer had to *parse* 695 KiB of JavaScript per document just to
 *      recover 534 KiB of WASM the worker already had in memory. Fetching the
 *      binary as an ArrayBuffer (kicked off by a ~200-byte prefetch script,
 *      overlapping the runtime download) is the remaining client-boot win
 *      from `bench/bottleneck/README.md` §3.
 *   2. The cookie snapshot lived in the document HTML, so a rewritten document
 *      could not be cached: replaying it would boot the client against a stale
 *      jar. Cookies (and the config, which is small and must stay current)
 *      now come from a no-store `${prefix}$boot` script, so the document body
 *      itself is cacheable under the same rules as any other subresource.
 *
 * This module is deliberately free of the WASM rewriter and the HTML parser so
 * the URL/source construction can be unit-tested as a leaf.
 */
import { config } from "./state";
import { appendUrlParams } from "./urlCodec";
import { INTERNAL_PARAMS } from "./internalParams";
import { bytesToBase64 } from "./base64";
import {
	PAGE_LOAD_CLIENT,
	WASM_BUFFER_KEY,
	WASM_PROMISE_KEY,
} from "./pageSurface";

export const ENGINE_BOOT_PATH = "$boot";
export const ENGINE_ERROR_PATH = "$error";

export function engineBootPathname(prefix: string): string {
	return prefix + ENGINE_BOOT_PATH;
}

export function engineErrorPathname(prefix: string): string {
	return prefix + ENGINE_ERROR_PATH;
}

let serializedConfig = "";
let serializedConfigSource: object | null = null;

/** `JSON.stringify(config)`, cached on config identity (see `setConfig`). */
export function configLiteral(): string {
	if (serializedConfigSource !== config) {
		serializedConfigSource = config;
		serializedConfig = JSON.stringify(config);
	}

	return serializedConfig;
}

export function bootScriptUrl(documentUrl: URL): string {
	return appendUrlParams(config.prefix + ENGINE_BOOT_PATH, {
		[INTERNAL_PARAMS.url]: documentUrl.href,
	});
}

/** An `http:`/`https:` URL, or `null` when the value is missing or not one. */
export function parseHttpUrl(value: string | null | undefined): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol === "http:" || url.protocol === "https:") return url;
	} catch {
		// Not a URL, or a scheme this dump must not run for (`about:`, `blob:`).
	}

	return null;
}

/**
 * The virtual document whose cookies `${prefix}$boot` may dump.
 *
 * `sherpa.url` is a hint from the injected script tag, not authentication.
 * Every virtual origin shares one physical origin, so a page could otherwise
 * `fetch("${prefix}$boot?sherpa.url=https://other.example/")` and read that
 * host's `document.cookie` jar. The hint is honored only when it same-origin
 * matches a URL the browser itself attributed to this request (Referer or the
 * requesting client); otherwise those trusted URLs win, and a request with
 * neither gets an empty jar.
 */
export function pickBootDocumentUrl(
	hinted: URL | null,
	referrerUrl: URL | null,
	clientUrl: URL | null
): URL | null {
	if (hinted) {
		if (referrerUrl && hinted.origin === referrerUrl.origin) return hinted;
		if (clientUrl && hinted.origin === clientUrl.origin) return hinted;
	}

	return referrerUrl || clientUrl;
}

const encoder = new TextEncoder();
let lastPrefetchSource = "";
let lastPrefetchBase64 = "";

function wasmPrefetchSrc(wasmUrl: string): string {
	// Kick the binary fetch off *before* the runtime bundle parses, so the two
	// overlap. The result is stashed on `self` for `getRewriter` to pick up;
	// `loadAndHook` also starts the same fetch in case this script was skipped
	// (a worker bootstrap, a srcdoc that inherited a different inject path).
	const source =
		"self." +
		WASM_PROMISE_KEY +
		"=fetch(" +
		JSON.stringify(wasmUrl) +
		").then(function(r){return r.arrayBuffer()}).then(function(b){self." +
		WASM_BUFFER_KEY +
		"=b;return b});" +
		"if('document' in self && document.currentScript)document.currentScript.remove();";
	if (source !== lastPrefetchSource) {
		lastPrefetchSource = source;
		lastPrefetchBase64 = bytesToBase64(encoder.encode(source));
	}

	return "data:application/javascript;base64," + lastPrefetchBase64;
}

/**
 * Script `src`s, in execution order, that a proxied document must load before
 * any of its own content runs.
 */
export function injectScriptSrcs(documentUrl: URL): string[] {
	return [
		wasmPrefetchSrc(config.files.wasm),
		config.files.all,
		bootScriptUrl(documentUrl),
	];
}

/**
 * The no-store `${prefix}$boot` body: a fresh cookie dump for this document
 * plus `loadAndHook`. `cookieDump` is `CookieStore.dumpForDocument`'s JSON
 * text, stringified again so it is a JS string literal `load()` can parse.
 */
export function renderBootScript(cookieDump: string): string {
	return (
		"self.COOKIE=" +
		JSON.stringify(cookieDump) +
		";" +
		PAGE_LOAD_CLIENT +
		"().loadAndHook(" +
		configLiteral() +
		');if("document" in self && document.currentScript)document.currentScript.remove();'
	);
}

/**
 * Classic-worker substitute for `importScripts(wasm)`. The wasm URL now
 * serves `application/wasm` bytes, which `importScripts` cannot evaluate, so
 * the worker pulls them with a synchronous XHR (the only way to keep
 * `loadAndHook` on the next line, before the worker's own top-level
 * `onmessage` runs). Module workers use top-level await + `fetch` instead.
 */
export function wasmSyncLoaderSource(wasmUrl: string): string {
	const href = JSON.stringify(wasmUrl);

	return (
		"(function(){var x=new XMLHttpRequest();x.open('GET'," +
		href +
		",false);try{x.responseType='arraybuffer'}catch(e){}" +
		"x.send(null);if(x.response instanceof ArrayBuffer)self." +
		WASM_BUFFER_KEY +
		"=x.response;" +
		"else{x=new XMLHttpRequest();x.open('GET'," +
		href +
		",false);x.overrideMimeType('text/plain; charset=x-user-defined');x.send(null);" +
		"var t=x.responseText,b=new Uint8Array(t.length);for(var i=0;i<t.length;i++)b[i]=t.charCodeAt(i)&255;" +
		"self." +
		WASM_BUFFER_KEY +
		"=b.buffer}})();\n"
	);
}
