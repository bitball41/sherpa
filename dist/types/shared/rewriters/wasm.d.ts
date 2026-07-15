import { URLMeta } from "./url";
export type JsRewriterOutput = {
    js: Uint8Array;
    map: Uint8Array;
    scramtag: string;
    errors: string[];
};
export interface Rewriter {
    rewrite_js(js: string, base: string, url: string, module: boolean): JsRewriterOutput;
    rewrite_js_bytes(js: Uint8Array, base: string, url: string, module: boolean): JsRewriterOutput;
    free(): void;
}
export declare function asyncSetWasm(): Promise<void>;
export declare const textDecoder: TextDecoder;
export declare function getRewriter(meta: URLMeta): [Rewriter, () => void];
