import type { SherpaConfig, SherpaInitConfig } from "../types";
/**
 * Applies a partial public configuration without dropping nested defaults.
 * Keeping this explicit also prevents special object keys from walking or
 * mutating the configuration prototype during a merge.
 */
export declare function mergeConfig(current: SherpaConfig, updates: Partial<SherpaInitConfig>): SherpaConfig;
