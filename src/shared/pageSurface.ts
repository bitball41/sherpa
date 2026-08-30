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
export const PAGE_LOAD_CLIENT = "$scramjetLoadClient";

export const PAGE_GLOBALS = {
	wrapfn: "$scramjet$wrap",
	wrappropertybase: "$scramjet__",
	wrappropertyfn: "$scramjet$prop",
	cleanrestfn: "$scramjet$clean",
	importfn: "$scramjet$import",
	rewritefn: "$scramjet$rewrite",
	metafn: "$scramjet$meta",
	setrealmfn: "$scramjet$setrealm",
	pushsourcemapfn: "$scramjet$pushsourcemap",
	trysetfn: "$scramjet$tryset",
	templocid: "$scramjet$temploc",
	tempunusedid: "$scramjet$tempunused",
} as const;

/** Prefix of the shadow attributes that keep a page's authored attribute values. */
export const SHADOW_ATTRIBUTE_PREFIX = "scramjet-attr-";

/**
 * Query-parameter namespace for engine hints on proxied URLs.
 * Must not collide with site parameters; must not spell "sherpa"/"bardo".
 */
export const INTERNAL_PARAM_PREFIX = "scramjet.";

/** Variant token on a Cache API key URL. Built from {@link INTERNAL_PARAM_PREFIX}. */
export const CACHE_KEY_PARAM = `${INTERNAL_PARAM_PREFIX}cache`;

export const WASM_PROMISE_KEY = "__scramjetWasm";
export const WASM_BUFFER_KEY = "__scramjetWasmBuffer";

export const MSG_TYPE = "scramjet$type";
export const MSG_TOKEN = "scramjet$token";
export const MSG_PORT = "scramjet$port";
export const DOLLAR_MSG_TYPE = "$scramjet$type";
export const DOLLAR_MSG_ORIGIN = "$scramjet$origin";
export const DOLLAR_MSG_DATA = "$scramjet$data";
export const DOLLAR_MSG_KIND = "$scramjet$messagetype";

export const CLIENT_SYMBOL_KEY = "scramjet client global";
export const FRAME_SYMBOL_KEY = "scramjet frame handle";

/** IndexedDB name. Pages can enumerate databases; must match Scramjet 1.x. */
export const PAGE_DB_NAME = "$scramjet";

/** `Symbol.for` key used to tag realm-pollution objects. */
export const REALM_POLLUTANT_KEY = "scramjet realm pollutant";

/** OPFS directory prefix for one virtual origin. Pages can list directories. */
export const STORAGE_DIRECTORY_PREFIX = "scramjet-";
