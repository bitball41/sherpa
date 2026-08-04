import type { SherpaConfig, SherpaFlags } from "../types";
/**
 * The active configuration and the codecs derived from it.
 *
 * This lives in its own leaf module rather than in `@/shared`'s barrel because
 * almost everything reads `config` - including the rewriters that the barrel
 * itself re-exports. Importing it from the barrel made `@/shared` and
 * `@/shared/rewriters/*` mutually dependent, which bundlers tolerate but which
 * makes the module graph order-sensitive for no reason. `@/shared` re-exports
 * everything here, so existing `from "@/shared"` imports are unaffected.
 */
export declare let codecEncode: (input: string) => string;
export declare let codecDecode: (input: string) => string;
export declare function loadCodecs(): void;
export declare function flagEnabled(flag: keyof SherpaFlags, url: URL): boolean;
export declare let config: SherpaConfig;
export declare function setConfig(newConfig: SherpaConfig): void;
