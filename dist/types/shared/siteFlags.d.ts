import type { SherpaConfig, SherpaFlags } from "../types";
export declare function flagEnabledForConfig(config: Pick<SherpaConfig, "flags" | "siteFlags">, flag: keyof SherpaFlags, url: URL): boolean;
