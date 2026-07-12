// thnank you node unblocker guy
import parse from "set-cookie-parser";

export type Cookie = {
	name: string;
	value: string;
	path?: string;
	expires?: string;
	maxAge?: number;
	domain?: string;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: "strict" | "lax" | "none";
};

export class CookieStore {
	private cookies: Record<string, Cookie> = {};

	setCookies(cookies: string[], url: URL) {
		for (const str of cookies) {
			const parsed = parse(str)[0];
			// an empty or malformed Set-Cookie header yields nothing usable;
			// storing it would poison the jar with a `name=undefined` entry
			if (!parsed || !parsed.name) continue;

			const cookie: Cookie = { ...parsed };

			if (!cookie.domain) cookie.domain = "." + url.hostname;
			if (!cookie.domain.startsWith(".")) cookie.domain = "." + cookie.domain;
			if (!cookie.path) cookie.path = "/";
			if (!cookie.sameSite) cookie.sameSite = "lax";

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
						: new Date(Date.now() + cookie.maxAge * 1000).toISOString();
			} else if (cookie.expires) {
				const expires = new Date(cookie.expires);
				cookie.expires = Number.isNaN(expires.getTime())
					? undefined
					: expires.toISOString();
			}

			const id = `${cookie.domain}@${cookie.path}@${cookie.name}`;
			this.cookies[id] = cookie;
		}
	}

	getCookies(url: URL, fromJs: boolean): string {
		const now = new Date();
		const cookies = Object.values(this.cookies);

		const validCookies: Cookie[] = [];

		for (const cookie of cookies) {
			if (cookie.expires && new Date(cookie.expires) < now) {
				delete this.cookies[`${cookie.domain}@${cookie.path}@${cookie.name}`];
				continue;
			}

			if (cookie.secure && url.protocol !== "https:") continue;
			if (cookie.httpOnly && fromJs) continue;

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
				const domain = cookie.domain.startsWith(".")
					? cookie.domain.slice(1)
					: cookie.domain;
				if (url.hostname !== domain && !url.hostname.endsWith("." + domain))
					continue;
			}

			validCookies.push(cookie);
		}

		return validCookies
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
		this.cookies = typeof cookies === "string" ? JSON.parse(cookies) : cookies;
	}

	dump(): string {
		return JSON.stringify(this.cookies);
	}
}
