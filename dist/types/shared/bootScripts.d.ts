export declare const ENGINE_BOOT_PATH = "$boot";
export declare const ENGINE_ERROR_PATH = "$error";
export declare function engineBootPathname(prefix: string): string;
export declare function engineErrorPathname(prefix: string): string;
/** `JSON.stringify(config)`, cached on config identity (see `setConfig`). */
export declare function configLiteral(): string;
export declare function bootScriptUrl(documentUrl: URL): string;
/** An `http:`/`https:` URL, or `null` when the value is missing or not one. */
export declare function parseHttpUrl(value: string | null | undefined): URL | null;
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
export declare function pickBootDocumentUrl(hinted: URL | null, referrerUrl: URL | null, clientUrl: URL | null): URL | null;
/**
 * Script `src`s, in execution order, that a proxied document must load before
 * any of its own content runs.
 */
export declare function injectScriptSrcs(documentUrl: URL): string[];
/**
 * The no-store `${prefix}$boot` body: a fresh cookie dump for this document
 * plus `loadAndHook`. `cookieDump` is `CookieStore.dumpForDocument`'s JSON
 * text, stringified again so it is a JS string literal `load()` can parse.
 */
export declare function renderBootScript(cookieDump: string): string;
/**
 * Classic-worker substitute for `importScripts(wasm)`. The wasm URL now
 * serves `application/wasm` bytes, which `importScripts` cannot evaluate, so
 * the worker pulls them with a synchronous XHR (the only way to keep
 * `loadAndHook` on the next line, before the worker's own top-level
 * `onmessage` runs). Module workers use top-level await + `fetch` instead.
 */
export declare function wasmSyncLoaderSource(wasmUrl: string): string;
