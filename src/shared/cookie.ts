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
			// sessions never expire.
			if (typeof cookie.maxAge === "number") {
				cookie.expires = new Date(Date.now() + cookie.maxAge * 1000).toString();
			} else if (cookie.expires) {
				cookie.expires = cookie.expires.toString();
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
			// leaking cookies to look-alike hosts.
			if (cookie.domain?.startsWith(".")) {
				const domain = cookie.domain.slice(1);
				if (url.hostname !== domain && !url.hostname.endsWith("." + domain))
					continue;
			}

			validCookies.push(cookie);
		}

		return validCookies
			.map((cookie) => `${cookie.name}=${cookie.value}`)
			.join("; ");
	}

	load(cookies: string) {
		if (typeof cookies === "object") return cookies;
		this.cookies = JSON.parse(cookies);
	}

	dump(): string {
		return JSON.stringify(this.cookies);
	}
}
