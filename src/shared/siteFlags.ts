import type { SherpaConfig, SherpaFlags } from "@/types";

// Flag checks run several times for every rewritten script/resource. A
// pattern string always compiles to the same RegExp, so cache both successful
// compilations and invalid entries across config replacements.
const siteFlagRegexes = new Map<string, RegExp | null>();

const hasOwn = Object.prototype.hasOwnProperty;

export function flagEnabledForConfig(
	config: Pick<SherpaConfig, "flags" | "siteFlags">,
	flag: keyof SherpaFlags,
	url: URL
): boolean {
	const value = config.flags[flag];
	const siteFlags = config.siteFlags;
	// for-in rather than Object.keys: this runs several times per rewritten
	// resource and the overwhelmingly common configuration has no per-site
	// overrides at all, where Object.keys still allocated an empty array on
	// every call. The own-property guard below keeps Object.keys' semantics.
	for (const regex in siteFlags) {
		if (!hasOwn.call(siteFlags, regex)) continue;
		const partialflags = siteFlags[regex];
		if (
			!partialflags ||
			typeof partialflags !== "object" ||
			!hasOwn.call(partialflags, flag)
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
