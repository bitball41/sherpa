// thnank you node unblocker guy
import parse from "set-cookie-parser";

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

const MAX_DATE_MS = 8.64e15;

function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function defaultCookiePath(pathname: string): string {
	if (!pathname.startsWith("/")) return "/";
	const lastSlash = pathname.lastIndexOf("/");

	return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

export class CookieStore {
	private cookies: Record<string, Cookie> = Object.create(null);

	private cookieId(cookie: Cookie): string {
		return `${cookie.domain}@${cookie.path}@${cookie.name}`;
	}

	setCookies(cookies: string[], url: URL, fromJs = false) {
		for (const str of cookies) {
			const parsed = parse(str)[0];
			// an empty or malformed Set-Cookie header yields nothing usable;
			// storing it would poison the jar with a `name=undefined` entry
			if (!parsed || !parsed.name) continue;

			const cookie: Cookie = { ...parsed };
			const hadDomainAttribute = cookie.domain !== undefined;
			const hadHostPath = cookie.path === "/";
			if (fromJs && cookie.httpOnly) continue;
			if (cookie.secure && url.protocol !== "https:") continue;
			if (cookie.name.startsWith("__Secure-") && !cookie.secure) continue;
			if (
				cookie.name.startsWith("__Host-") &&
				(!cookie.secure || hadDomainAttribute || !hadHostPath)
			)
				continue;

			const requestHost = url.hostname.toLowerCase();
			if (cookie.domain) {
				const domain = cookie.domain.replace(/^\.+/, "").toLowerCase();
				// A response may only set a Domain cookie for its own host or a
				// parent domain. Silently reject attempts to plant cookies elsewhere.
				if (!domain || !domainMatches(requestHost, domain)) continue;
				cookie.domain = domain;
				cookie.hostOnly = false;
			} else {
				cookie.domain = requestHost;
				cookie.hostOnly = true;
			}
			if (!cookie.path || !cookie.path.startsWith("/"))
				cookie.path = defaultCookiePath(url.pathname);
			cookie.sameSite = cookie.sameSite?.toLowerCase() as Cookie["sameSite"];
			if (!(["strict", "lax", "none"] as string[]).includes(cookie.sameSite))
				cookie.sameSite = "lax";
			if (cookie.sameSite === "none" && !cookie.secure) continue;

			// Max-Age takes precedence over Expires (RFC 6265 §4.1.2.2) and is
			// how sites both set session lifetimes and *delete* cookies
			// (Max-Age=0). getCookies only consults `expires`, so fold Max-Age
			// into an absolute expiry here — otherwise a Max-Age=0 deletion is
			// silently ignored and the cookie is served forever, and Max-Age
			// sessions never expire. Stored as ISO 8601 (timezone-agnostic).
			// A non-numeric Max-Age (parses to NaN) or unparseable Expires is
			// ignored per §5.2.2/§5.2.1 — the cookie becomes a session cookie —
			// instead of storing a never-expiring "Invalid Date".
			if (typeof cookie.maxAge === "number" && Number.isFinite(cookie.maxAge)) {
				// §5.2.2: delta-seconds <= 0 → the earliest representable date,
				// so a Max-Age=0 deletion can't race the expiry sweep's `<` within
				// the same millisecond
				cookie.expires =
					cookie.maxAge <= 0
						? new Date(0).toISOString()
						: new Date(
								Math.min(Date.now() + cookie.maxAge * 1000, MAX_DATE_MS)
							).toISOString();
			} else if (cookie.expires) {
				const expires = new Date(cookie.expires);
				cookie.expires = Number.isNaN(expires.getTime())
					? undefined
					: expires.toISOString();
			}

			const id = this.cookieId(cookie);
			if (fromJs && this.cookies[id]?.httpOnly) continue;
			this.cookies[id] = cookie;
		}
	}

	getCookies(url: URL, fromJs: boolean, context?: CookieAccessContext): string {
		const now = new Date();
		const cookies = Object.values(this.cookies);

		const validCookies: Cookie[] = [];

		for (const cookie of cookies) {
			if (cookie.expires && new Date(cookie.expires) < now) {
				delete this.cookies[this.cookieId(cookie)];
				continue;
			}

			if (cookie.secure && url.protocol !== "https:") continue;
			if (cookie.httpOnly && fromJs) continue;
			if (context && !context.sameSite) {
				if (cookie.sameSite === "strict") continue;
				if (
					cookie.sameSite === "lax" &&
					(!context.topLevelNavigation ||
						!["GET", "HEAD", "OPTIONS", "TRACE"].includes(
							context.method.toUpperCase()
						))
				)
					continue;
			}

			// RFC 6265 §5.1.4 path-match: the cookie's path must equal the
			// request path, or be a prefix of it that ends on a "/" boundary.
			// A bare startsWith wrongly matched cookie path "/foo" against
			// request path "/foobar", leaking cookies across sibling paths.
			const path = cookie.path || "/";
			if (url.pathname !== path) {
				if (!url.pathname.startsWith(path)) continue;
				if (!path.endsWith("/") && url.pathname[path.length] !== "/") continue;
			}

			// RFC 6265 §5.1.3 domain-match: the request host must equal the
			// cookie domain or be a subdomain of it. A bare endsWith wrongly
			// matched cookie domain ".example.com" against "notexample.com",
			// leaking cookies to look-alike hosts. The leading dot is optional
			// here (setCookies always stores one, but load()ed data may not) so
			// a dotless entry can't bypass the check and match every host.
			if (cookie.domain) {
				const domain = cookie.domain.replace(/^\.+/, "").toLowerCase();
				const hostname = url.hostname.toLowerCase();
				if (cookie.hostOnly) {
					if (hostname !== domain) continue;
				} else if (!domainMatches(hostname, domain)) {
					continue;
				}
			}

			validCookies.push(cookie);
		}

		return validCookies
			.sort((a, b) => (b.path?.length || 1) - (a.path?.length || 1))
			.map((cookie) => `${cookie.name}=${cookie.value}`)
			.join("; ");
	}

	load(cookies: string | Record<string, Cookie>) {
		// The jar is persisted two different ways: the client injects it as a
		// JSON string (`self.COOKIE`), while the service worker restores it from
		// IndexedDB, where it round-trips back as an already-structured object.
		// Both have to land in `this.cookies` — the old `typeof === "object"`
		// branch returned the object without ever assigning it, so the worker's
		// persisted cookies were silently dropped on every service-worker
		// restart (session logins didn't survive until the site re-set them).
		const loaded: Record<string, Cookie> =
			typeof cookies === "string" ? JSON.parse(cookies) : cookies;
		const normalized: Record<string, Cookie> = Object.create(null);
		for (const cookie of Object.values(loaded || {})) {
			if (!cookie || !cookie.name || !cookie.domain) continue;
			cookie.domain = cookie.domain.replace(/^\.+/, "").toLowerCase();
			cookie.path ||= "/";
			cookie.hostOnly ??= false;
			if (cookie.name.startsWith("__Secure-") && !cookie.secure) continue;
			if (
				cookie.name.startsWith("__Host-") &&
				(!cookie.secure || !cookie.hostOnly || cookie.path !== "/")
			)
				continue;
			cookie.sameSite = cookie.sameSite?.toLowerCase() as Cookie["sameSite"];
			if (
				!(["strict", "lax", "none"] as string[]).includes(cookie.sameSite) ||
				(cookie.sameSite === "none" && !cookie.secure)
			)
				cookie.sameSite = "lax";
			normalized[this.cookieId(cookie)] = cookie;
		}
		this.cookies = normalized;
	}

	dump(): string {
		return JSON.stringify(this.cookies);
	}

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
	dumpForDocument(url: URL): string {
		const visible: Record<string, Cookie> = Object.create(null);
		const hostname = url.hostname.toLowerCase();

		for (const id of Object.keys(this.cookies)) {
			const cookie = this.cookies[id];
			if (!cookie || cookie.httpOnly) continue;

			const domain = (cookie.domain || "").replace(/^\.+/, "").toLowerCase();
			if (!domain) continue;
			if (
				cookie.hostOnly ? hostname !== domain : !domainMatches(hostname, domain)
			)
				continue;

			visible[id] = cookie;
		}

		return JSON.stringify(visible);
	}
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
export function couldShareCookies(
	documentHost: string,
	responseHost: string
): boolean {
	const document = documentHost.toLowerCase();
	const response = responseHost.toLowerCase();

	return domainMatches(document, response) || domainMatches(response, document);
}
