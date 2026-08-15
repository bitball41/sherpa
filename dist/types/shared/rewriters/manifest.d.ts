/**
 * Web app manifests are the one *data* format the platform resolves URLs out
 * of. Sherpa passed them straight through, so every icon, screenshot and
 * shortcut in an installable site resolved against the proxy's own origin
 * instead of the site's - the manifest either 404'd its icons or, with
 * `start_url` pointing at the proxy root, offered an install that escaped the
 * proxy entirely.
 *
 * Members are per the Web App Manifest spec, plus the widely-shipped
 * `share_target`, `protocol_handlers` and `file_handlers` extensions. Unknown
 * members are left exactly as they are: a manifest is site data, and guessing
 * at which strings are URLs would corrupt it.
 *
 * Like `importMap.ts`, this takes the URL rewriter as a callback rather than
 * importing it, so it stays free of the WASM rewriter and can be tested on its
 * own.
 */
type JsonRecord = Record<string, unknown>;
/** Rewrites every URL-valued member of a parsed manifest, in place. */
export declare function rewriteManifestObject(manifest: JsonRecord, rewrite: (url: string) => string): void;
/**
 * Rewrites a manifest response body. Anything that isn't a parseable JSON
 * object is handed back untouched - a broken manifest is the site's problem,
 * and replacing it with an error would be worse than passing it along.
 */
export declare function rewriteManifest(json: string, rewrite: (url: string) => string): string;
export {};
