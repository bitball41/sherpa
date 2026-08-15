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
    /**
     * The jar as one document's realm is allowed to see it.
     *
     * {@link dump} serializes the *whole* jar — every host the session has ever
     * touched, `httpOnly` entries included. That is what persistence needs, and
     * it is what used to be injected into every proxied document as
     * `self.COOKIE`. Every virtual origin Sherpa serves shares one *physical*
     * origin, so a proxied page can reach into any frame it embeds and read
     * that frame's client directly — which meant embedding a single iframe
     * handed a page the session cookies of every unrelated site behind the
     * proxy, `httpOnly` ones included, none of which that realm has any way to
     * legitimately observe.
     *
     * A page realm needs exactly what `document.cookie` may return there, which
     * is never an `httpOnly` cookie and never another host's. Path is
     * deliberately not filtered: a same-document navigation (`pushState`) can
     * move the document's path, and the read path applies the path rule
     * anyway.
     */
    dumpForDocument(url: URL): string;
}
/**
 * Whether a cookie set by a response from `responseHost` could ever be read by
 * `documentHost`'s `document.cookie`.
 *
 * The exact `Domain` attribute isn't known here (it hasn't been parsed yet),
 * but a cookie is only ever visible on its own host or a subdomain of the
 * domain it claims, and a response may only claim its own host or a parent of
 * it — so any visible combination has one host as a suffix of the other.
 */
export declare function couldShareCookies(documentHost: string, responseHost: string): boolean;
