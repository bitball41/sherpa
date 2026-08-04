import type { SherpaConfig, SherpaFlags } from "@/types";
import { flagEnabledForConfig } from "./siteFlags";

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

export let codecEncode: (input: string) => string;
export let codecDecode: (input: string) => string;

const nativeFunction = Function;
export function loadCodecs() {
	codecEncode = nativeFunction(`return ${config.codec.encode}`)() as any;
	codecDecode = nativeFunction(`return ${config.codec.decode}`)() as any;
}

export function flagEnabled(flag: keyof SherpaFlags, url: URL): boolean {
	return flagEnabledForConfig(config, flag, url);
}

export let config: SherpaConfig;
export function setConfig(newConfig: SherpaConfig) {
	config = newConfig;
	loadCodecs();
}
