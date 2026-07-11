/**
 * @fileoverview
 * Unit tests for the service-worker/client cookie jar (`CookieStore`).
 *
 * These pin the RFC 6265 matching semantics for the read path
 * (`getCookies`) and the Max-Age handling on the write path
 * (`setCookies`) — three places the inherited implementation diverged from
 * the spec in ways real sites trip over:
 *
 *   1. path-match used a bare `startsWith`, so cookie path "/foo" leaked onto
 *      request path "/foobar" (§5.1.4).
 *   2. domain-match used a bare `endsWith`, so cookie domain ".example.com"
 *      leaked onto host "notexample.com" (§5.1.3).
 *   3. `Max-Age` was parsed but never consulted for expiry, so `Max-Age=0`
 *      cookie deletions were ignored and the cookie was served forever
 *      (§4.1.2.2 / §5.3).
 *
 * `CookieStore` only depends on `set-cookie-parser` (a normal dependency), so
 * it loads directly from TypeScript via Node's built-in type stripping; run
 * with `pnpm test:unit` (or `node --test tests/unit/`).
 */
import test from "node:test";
import assert from "node:assert/strict";

const { CookieStore } = await import("../../src/shared/cookie.ts");

const cookieNames = (jarString) =>
	jarString
		.split("; ")
		.filter(Boolean)
		.map((pair) => pair.split("=")[0])
		.sort();

test("path-match does not leak a cookie onto a sibling path prefix", () => {
	const store = new CookieStore();
	store.setCookies(["a=1; Path=/foo"], new URL("https://example.com/foo"));

	// exact path and a real subpath match
	assert.equal(
		store.getCookies(new URL("https://example.com/foo"), false),
		"a=1"
	);
	assert.equal(
		store.getCookies(new URL("https://example.com/foo/bar"), false),
		"a=1"
	);

	// "/foobar" merely shares a string prefix — it must NOT match
	assert.equal(
		store.getCookies(new URL("https://example.com/foobar"), false),
		""
	);
	assert.equal(store.getCookies(new URL("https://example.com/"), false), "");
});

test("a root-path cookie matches every path", () => {
	const store = new CookieStore();
	store.setCookies(["a=1; Path=/"], new URL("https://example.com/"));

	assert.equal(store.getCookies(new URL("https://example.com/"), false), "a=1");
	assert.equal(
		store.getCookies(new URL("https://example.com/anything/deep"), false),
		"a=1"
	);
});

test("domain-match does not leak a cookie onto a look-alike host", () => {
	const store = new CookieStore();
	store.setCookies(
		["a=1; Domain=example.com"],
		new URL("https://example.com/")
	);

	// the domain itself and true subdomains match
	assert.equal(store.getCookies(new URL("https://example.com/"), false), "a=1");
	assert.equal(
		store.getCookies(new URL("https://sub.example.com/"), false),
		"a=1"
	);

	// "notexample.com" only shares a suffix — it must NOT match
	assert.equal(store.getCookies(new URL("https://notexample.com/"), false), "");
});

test("Max-Age=0 deletes a cookie instead of serving it forever", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["sess=abc; Path=/"], url);
	assert.equal(store.getCookies(url, false), "sess=abc");

	// the canonical "delete this cookie" response
	store.setCookies(["sess=; Path=/; Max-Age=0"], url);
	assert.equal(store.getCookies(url, false), "");
});

test("a positive Max-Age keeps the cookie valid (and overrides it)", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["a=1; Path=/; Max-Age=3600"], url);
	assert.equal(store.getCookies(url, false), "a=1");
});

test("an expired Expires date is still honored", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["a=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"], url);
	assert.equal(store.getCookies(url, false), "");
});

test("secure cookies are withheld from http and httpOnly from JS reads", () => {
	const store = new CookieStore();
	store.setCookies(
		["s=1; Path=/; Secure", "h=1; Path=/; HttpOnly"],
		new URL("https://example.com/")
	);

	// over http, the Secure cookie is withheld
	assert.deepEqual(
		cookieNames(store.getCookies(new URL("http://example.com/"), false)),
		["h"]
	);
	// a document.cookie read (fromJs) cannot see the HttpOnly cookie
	assert.deepEqual(
		cookieNames(store.getCookies(new URL("https://example.com/"), true)),
		["s"]
	);
});

test("a malformed Set-Cookie header does not poison the jar", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["", "   ", "=nonsense"], url);
	assert.equal(store.getCookies(url, false), "");

	store.setCookies(["real=1; Path=/"], url);
	assert.equal(store.getCookies(url, false), "real=1");
});
