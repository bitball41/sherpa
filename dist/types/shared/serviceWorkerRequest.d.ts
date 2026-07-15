export type TransferredRequestMetadata = {
    body: ReadableStream | null;
    headers: [string, string][];
    method: string;
    mode: RequestMode;
    credentials: RequestCredentials;
    cache: RequestCache;
    redirect: RequestRedirect;
    referrer: string;
    referrerPolicy: ReferrerPolicy;
    integrity: string;
    keepalive: boolean;
};
/**
 * Builds the native RequestInit used inside an emulated service worker. The
 * public Request properties are decorated separately, but these values must
 * also live in the Request's internal slots so `fetch(event.request)` keeps
 * the original credentials/cache/redirect behavior.
 */
export declare function createTransferredRequestInit(request: TransferredRequestMetadata): RequestInit & {
    duplex?: "half";
};
