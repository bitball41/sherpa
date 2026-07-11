import type { SherpaConfig, SherpaInitConfig } from "@/types";

function serializeCodec(codec: string | ((url: string) => string)): string {
	return typeof codec === "function" ? codec.toString() : codec;
}

/**
 * Applies a partial public configuration without dropping nested defaults.
 * Keeping this explicit also prevents special object keys from walking or
 * mutating the configuration prototype during a merge.
 */
export function mergeConfig(
	current: SherpaConfig,
	updates: Partial<SherpaInitConfig>
): SherpaConfig {
	return {
		prefix: updates.prefix ?? current.prefix,
		globals: { ...current.globals, ...updates.globals },
		files: { ...current.files, ...updates.files },
		flags: { ...current.flags, ...updates.flags },
		siteFlags: { ...current.siteFlags, ...updates.siteFlags },
		errorPage: { ...current.errorPage, ...updates.errorPage },
		codec: {
			encode: serializeCodec(updates.codec?.encode ?? current.codec.encode),
			decode: serializeCodec(updates.codec?.decode ?? current.codec.decode),
		},
	};
}
