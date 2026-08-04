export declare const DEFAULT_REFERRER_POLICY: ReferrerPolicy;
/** Selects the last recognized policy from a Referrer-Policy header. */
export declare function selectReferrerPolicy(value: string): ReferrerPolicy | null;
/** Applies a parsed policy to one outgoing Referer value. */
export declare function createReferrerValue(policy: ReferrerPolicy, source: URL, target: URL): string | null;
