import { Rewriter } from "../../../rewriter/wasm/out/wasm.js";
import type { JsRewriterOutput } from "../../../rewriter/wasm/out/wasm.js";
export type { JsRewriterOutput, Rewriter };
export declare function asyncSetWasm(): Promise<void>;
export declare const textDecoder: TextDecoder;
export declare function getRewriter(base: URL): [Rewriter, () => void];
