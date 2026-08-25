/**
 * Identifiers that appear in rewritten documents and in the client bundle
 * injected into every proxied page.
 *
 * Sherpa is a Scramjet 1.x fork. Host APIs stay Sherpa (`$sherpaLoadController`,
 * the package name, the demo). Everything a *site* can observe — wrap
 * functions, shadow attributes, query hints, boot globals, postMessage keys —
 * uses the Scramjet 1.x spellings so a proxied page does not advertise a
 * distinct product. That is page fidelity, not anti-detect: the rewritten
 * document should look like the original site plus the same client surface
 * stock Scramjet already ships.
 */
export declare const PAGE_LOAD_CLIENT = "$scramjetLoadClient";
export declare const PAGE_GLOBALS: {
    readonly wrapfn: "$scramjet$wrap";
    readonly wrappropertybase: "$scramjet__";
    readonly wrappropertyfn: "$scramjet$prop";
    readonly cleanrestfn: "$scramjet$clean";
    readonly importfn: "$scramjet$import";
    readonly rewritefn: "$scramjet$rewrite";
    readonly metafn: "$scramjet$meta";
    readonly setrealmfn: "$scramjet$setrealm";
    readonly pushsourcemapfn: "$scramjet$pushsourcemap";
    readonly trysetfn: "$scramjet$tryset";
    readonly templocid: "$scramjet$temploc";
    readonly tempunusedid: "$scramjet$tempunused";
};
/** Prefix of the shadow attributes that keep a page's authored attribute values. */
export declare const SHADOW_ATTRIBUTE_PREFIX = "scramjet-attr-";
/**
 * Query-parameter namespace for engine hints on proxied URLs.
 * Must not collide with site parameters; must not spell "sherpa"/"bardo".
 */
export declare const INTERNAL_PARAM_PREFIX = "scramjet.";
/** Variant token on a Cache API key URL. Built from {@link INTERNAL_PARAM_PREFIX}. */
export declare const CACHE_KEY_PARAM = "scramjet.cache";
export declare const WASM_PROMISE_KEY = "__scramjetWasm";
export declare const WASM_BUFFER_KEY = "__scramjetWasmBuffer";
export declare const MSG_TYPE = "scramjet$type";
export declare const MSG_TOKEN = "scramjet$token";
export declare const MSG_PORT = "scramjet$port";
export declare const DOLLAR_MSG_TYPE = "$scramjet$type";
export declare const DOLLAR_MSG_ORIGIN = "$scramjet$origin";
export declare const DOLLAR_MSG_DATA = "$scramjet$data";
export declare const DOLLAR_MSG_KIND = "$scramjet$messagetype";
export declare const CLIENT_SYMBOL_KEY = "scramjet client global";
export declare const FRAME_SYMBOL_KEY = "scramjet frame handle";
/** IndexedDB name. Pages can enumerate databases; must match Scramjet 1.x. */
export declare const PAGE_DB_NAME = "$scramjet";
/** `Symbol.for` key used to tag realm-pollution objects. */
export declare const REALM_POLLUTANT_KEY = "scramjet realm pollutant";
/** OPFS directory prefix for one virtual origin. Pages can list directories. */
export declare const STORAGE_DIRECTORY_PREFIX = "scramjet-";
