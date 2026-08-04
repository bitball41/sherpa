export type Cookie = {
    name: string;
    value: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    domain?: string;
    hostOnly?: boolean;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "strict" | "lax" | "none";
};
export type CookieAccessContext = {
    sameSite: boolean;
    topLevelNavigation: boolean;
    method: string;
};
export declare class CookieStore {
    private cookies;
    private cookieId;
    setCookies(cookies: string[], url: URL, fromJs?: boolean): void;
    getCookies(url: URL, fromJs: boolean, context?: CookieAccessContext): string;
    load(cookies: string | Record<string, Cookie>): void;
    dump(): string;
}
