import { SherpaConfig, SherpaFlags } from "@/types";

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

// flagEnabled runs several times for every rewritten script/resource;
// compiling the siteFlags patterns on every call is pure waste, and a
// pattern string always compiles to the same RegExp so the cache can never
// go stale across config updates
const siteFlagRegexes = new Map<string, RegExp>();

export function flagEnabled(flag: keyof SherpaFlags, url: URL): boolean {
	const value = config.flags[flag];
	for (const regex in config.siteFlags) {
		const partialflags = config.siteFlags[regex];
		if (!(flag in partialflags)) continue;

		let compiled = siteFlagRegexes.get(regex);
		if (!compiled) {
			compiled = new RegExp(regex);
			siteFlagRegexes.set(regex, compiled);
		}
		if (compiled.test(url.href)) {
			return partialflags[flag];
		}
	}

	return value;
}

export let config: SherpaConfig;
export function setConfig(newConfig: SherpaConfig) {
	config = newConfig;
	loadCodecs();
}
