import type { SherpaConfig, SherpaFlags } from "@/types";

// Flag checks run several times for every rewritten script/resource. A
// pattern string always compiles to the same RegExp, so cache both successful
// compilations and invalid entries across config replacements.
const siteFlagRegexes = new Map<string, RegExp | null>();

export function flagEnabledForConfig(
	config: Pick<SherpaConfig, "flags" | "siteFlags">,
	flag: keyof SherpaFlags,
	url: URL
): boolean {
	const value = config.flags[flag];
	for (const regex of Object.keys(config.siteFlags)) {
		const partialflags = config.siteFlags[regex];
		if (
			!partialflags ||
			typeof partialflags !== "object" ||
			!Object.prototype.hasOwnProperty.call(partialflags, flag)
		)
			continue;
		const override = partialflags[flag];
		if (typeof override !== "boolean") continue;

		let compiled: RegExp | null;
		if (siteFlagRegexes.has(regex)) {
			compiled = siteFlagRegexes.get(regex) || null;
		} else {
			try {
				compiled = new RegExp(regex);
			} catch (error) {
				console.warn(`ignoring invalid siteFlags pattern ${regex}`, error);
				compiled = null;
			}
			siteFlagRegexes.set(regex, compiled);
		}
		if (!compiled) continue;
		if (compiled.test(url.href)) return override;
	}

	return value;
}
