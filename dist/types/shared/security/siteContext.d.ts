/**
 * Whether a computed `Sec-Fetch-Site` directive should count as a same-site
 * context when deciding which SameSite cookies to attach to an upstream
 * request.
 *
 * Only a genuinely `cross-site` request restricts SameSite cookies. A `none`
 * directive is an initiator-less top-level request — the address bar, a
 * bookmark, an opened window, or a navigation whose referrer was stripped —
 * which browsers treat as same-site for cookie purposes and therefore DO send
 * `SameSite=Strict` cookies on. Treating `none` as cross-site would withhold
 * Strict session cookies on the first/direct navigation to a site, making it
 * look logged-out until some later same-site sub-navigation re-sent them.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site#directives
 */
export declare function isSameSiteContext(siteDirective: string): boolean;
