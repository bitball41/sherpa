/**
 * Public, package-contained view of the wasm-bindgen rewrite result.
 * Keep this structural so declarations never reference build-only glue files.
 */
export type JsRewriterOutput = {
    js: Uint8Array;
    map: Uint8Array;
    scramtag: string;
    errors: string[];
};
/** Public structural view of the runtime WASM rewriter. */
export interface Rewriter {
    free(): void;
    rewrite_js(js: string, base: string, url: string, module: boolean): JsRewriterOutput;
    rewrite_js_bytes(js: Uint8Array, base: string, url: string, module: boolean): JsRewriterOutput;
}
import { URLMeta } from "./url";
export declare function asyncSetWasm(): Promise<void>;
export declare const textDecoder: TextDecoder;
export declare function getRewriter(meta: URLMeta): [Rewriter, () => void];
