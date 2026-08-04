/**
 * Rewrites each URI reference in an RFC 8288 Link header while preserving
 * parameters, quoted commas, and the angle brackets around every target.
 */
export declare function rewriteLinkHeader(value: string, rewrite: (url: string) => string): string;
