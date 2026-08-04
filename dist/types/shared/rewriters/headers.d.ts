import type { default as BareClient, BareHeaders } from "@mercuryworkshop/bare-mux";
import { type URLMeta } from "./url";
interface StoredReferrerPolicies {
    get(url: string): Promise<{
        policy: string;
        referrer: string;
    } | null>;
    set(url: string, policy: string, referrer: string): Promise<void>;
}
/**
 * Rewrites response headers
 * @param rawHeaders Headers before they were rewritten
 * @param meta Parsed Proxy URL
 * @param client `BareClient` instance used for fetching
 * @param storedReferrerPolicies Referrer policies remembered for proxied origins
 */
export declare function rewriteHeaders(rawHeaders: BareHeaders, meta: URLMeta, client: BareClient, storedReferrerPolicies: StoredReferrerPolicies): Promise<BareHeaders>;
export {};
