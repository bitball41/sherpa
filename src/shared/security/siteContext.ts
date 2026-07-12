/**
 * The `Sec-Fetch-Site` directives that count as a same-site context when
 * deciding which SameSite cookies to attach to an upstream request.
 *
 * `none` MUST stay in this set: it is an initiator-less top-level request —
 * the address bar, a bookmark, an opened window, or a navigation whose
 * referrer was stripped — which browsers treat as same-site for cookie
 * purposes and therefore DO send `SameSite=Strict` cookies on. Dropping it
 * would withhold Strict session cookies on the first/direct navigation to a
 * site, making it look logged-out until some later same-site sub-navigation
 * re-sent them.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site#directives
 */
const SAME_SITE_DIRECTIVES = new Set(["none", "same-origin", "same-site"]);

/**
 * Whether a computed `Sec-Fetch-Site` directive should count as a same-site
 * context for SameSite cookie delivery.
 *
 * This is a security gate for SameSite's CSRF protection, so it fails closed:
 * anything that isn't a known same-site directive (including an empty or
 * unexpected value) is treated as cross-site and withholds Strict/Lax cookies,
 * rather than sending them on a request that couldn't be classified.
 */
export function isSameSiteContext(siteDirective: string): boolean {
	return SAME_SITE_DIRECTIVES.has(siteDirective);
}
