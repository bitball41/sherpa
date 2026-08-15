import { Rewriter } from "../../../rewriter/wasm/out/wasm.js";
import type { JsRewriterOutput } from "../../../rewriter/wasm/out/wasm.js";
export type { JsRewriterOutput, Rewriter };
/** The rewriter bytes already loaded in this realm, if any. */
export declare function getWasmBytes(): Uint8Array<ArrayBuffer> | undefined;
export declare function asyncSetWasm(): Promise<void>;
/**
 * Starts (or joins) the binary WASM fetch the document's prefetch script
 * kicked off. Safe to call when the bytes are already present - including
 * the `REWRITERWASM`-embedded bundle, which never fetches.
 */
export declare function beginWasmFetch(url: string): Promise<Uint8Array<ArrayBuffer>>;
export declare const textDecoder: TextDecoder;
export declare function getRewriter(base: URL): [Rewriter, () => void];
