import type { SherpaConfig, SherpaFlags } from "@/types";
import { flagEnabledForConfig } from "./siteFlags";

export * from "./cookie";
export * from "./errorPage";
export * from "./headers";
export * from "./htmlRules";
export * from "./rewriters";
export * from "./security";

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
