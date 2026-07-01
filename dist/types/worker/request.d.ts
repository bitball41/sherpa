export type VirtualRequestContext = {
    credentials: RequestCredentials;
    initiatorUrl: URL | null;
    isNavigation: boolean;
    isSameOrigin: boolean;
    method: string;
    mode: RequestMode;
    referrerPolicy: ReferrerPolicy;
    referrerUrl: URL | null;
    targetUrl: URL;
};
export declare function createVirtualRequestContext(request: Request, client: Client | null, targetUrl: URL): VirtualRequestContext;
export declare function shouldSendCookies(context: VirtualRequestContext): boolean;
export declare function createRefererHeader(context: VirtualRequestContext): string | null;
export declare function createOriginHeader(context: VirtualRequestContext): string | null;
