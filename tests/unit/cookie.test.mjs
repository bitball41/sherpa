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

test("a cookie without Domain is host-only", () => {
	const store = new CookieStore();
	store.setCookies(["a=1"], new URL("https://example.com/account/login"));

	assert.equal(
		store.getCookies(new URL("https://example.com/account/home"), false),
		"a=1"
	);
	assert.equal(
		store.getCookies(new URL("https://sub.example.com/account/home"), false),
		""
	);
});

test("rejects a Domain attribute unrelated to the response host", () => {
	const store = new CookieStore();
	store.setCookies(
		["poison=1; Domain=evil.test; Path=/"],
		new URL("https://example.com/")
	);

	assert.equal(store.getCookies(new URL("https://evil.test/"), false), "");
	assert.equal(store.dump(), "{}");
});

test("normalizes Domain case and applies the RFC default path", () => {
	const store = new CookieStore();
	store.setCookies(
		["a=1; Domain=EXAMPLE.COM"],
		new URL("https://example.com/docs/page.html")
	);

	assert.equal(
		store.getCookies(new URL("https://sub.example.com/docs/next"), false),
		"a=1"
	);
	assert.equal(
		store.getCookies(new URL("https://example.com/other"), false),
		""
	);
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

test("a very large finite Max-Age is clamped to a valid date", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	assert.doesNotThrow(() =>
		store.setCookies(["a=1; Path=/; Max-Age=1e300"], url)
	);
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

test("rejects Secure cookies received over an insecure connection", () => {
	const store = new CookieStore();
	store.setCookies(["s=1; Path=/; Secure"], new URL("http://example.com/"));

	assert.equal(store.getCookies(new URL("https://example.com/"), false), "");
});

test("document.cookie cannot create or overwrite HttpOnly cookies", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");
	store.setCookies(["secret=server; Path=/; HttpOnly"], url);
	store.setCookies(["created=js; Path=/; HttpOnly"], url, true);
	store.setCookies(["secret=overwritten; Path=/"], url, true);

	assert.equal(store.getCookies(url, true), "");
	assert.equal(store.getCookies(url, false), "secret=server");
});

test("SameSite cookies are filtered for cross-site subresources and navigations", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");
	store.setCookies(
		[
			"strict=1; Path=/; SameSite=Strict",
			"lax=1; Path=/; SameSite=Lax",
			"none=1; Path=/; SameSite=None; Secure",
		],
		url
	);

	assert.deepEqual(
		cookieNames(
			store.getCookies(url, false, {
				sameSite: false,
				topLevelNavigation: false,
				method: "GET",
			})
		),
		["none"]
	);
	assert.deepEqual(
		cookieNames(
			store.getCookies(url, false, {
				sameSite: false,
				topLevelNavigation: true,
				method: "GET",
			})
		),
		["lax", "none"]
	);
	assert.deepEqual(
		cookieNames(
			store.getCookies(url, false, {
				sameSite: false,
				topLevelNavigation: true,
				method: "POST",
			})
		),
		["none"]
	);
});

test("SameSite=None without Secure is rejected", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");
	store.setCookies(["bad=1; SameSite=None"], url);

	assert.equal(store.getCookies(url, false), "");
});

test("a malformed Set-Cookie header does not poison the jar", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["", "   ", "=nonsense"], url);
	assert.equal(store.getCookies(url, false), "");

	store.setCookies(["real=1; Path=/"], url);
	assert.equal(store.getCookies(url, false), "real=1");
});

test("a non-numeric Max-Age is ignored, not stored as an invalid date", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	// NaN Max-Age must not clobber a valid (already-past) Expires
	store.setCookies(
		["a=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=abc"],
		url
	);
	assert.equal(store.getCookies(url, false), "");

	// NaN Max-Age alone → plain session cookie, still served
	store.setCookies(["b=1; Path=/; Max-Age=xyz"], url);
	assert.equal(store.getCookies(url, false), "b=1");
});

test("an unparseable Expires falls back to a session cookie", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(["a=1; Path=/; Expires=banana"], url);
	assert.equal(store.getCookies(url, false), "a=1");

	// and the junk date is not persisted into the jar
	const dumped = Object.values(JSON.parse(store.dump()));
	assert.equal(dumped.length, 1);
	assert.equal(dumped[0].expires, undefined);
});

test("expiry dates are stored in timezone-agnostic ISO form", () => {
	const store = new CookieStore();
	const url = new URL("https://example.com/");

	store.setCookies(
		[
			"a=1; Path=/; Max-Age=3600",
			"b=1; Path=/; Expires=Fri, 01 Jan 2100 00:00:00 GMT",
		],
		url
	);

	for (const cookie of Object.values(JSON.parse(store.dump()))) {
		// toISOString round-trips exactly; a locale toString() would not
		assert.equal(new Date(cookie.expires).toISOString(), cookie.expires);
	}
});

test("load() restores a jar from an already-parsed object (SW/IndexedDB path)", () => {
	// The service worker persists the jar to IndexedDB and restores it as a
	// structured-cloned object (not a string). load() must accept that shape;
	// the old early return on objects silently dropped the whole jar, so
	// cookies did not survive a service-worker restart.
	const source = new CookieStore();
	source.setCookies(
		["a=1; Path=/", "b=2; Path=/"],
		new URL("https://example.com/")
	);
	const persisted = JSON.parse(source.dump()); // what db.get() hands back

	const restored = new CookieStore();
	restored.load(persisted);

	assert.equal(
		restored.getCookies(new URL("https://example.com/"), false),
		"a=1; b=2"
	);
});

test("dump()/load() round-trips through a JSON string (client path)", () => {
	const source = new CookieStore();
	source.setCookies(["sess=xyz; Path=/"], new URL("https://example.com/"));

	const restored = new CookieStore();
	restored.load(source.dump()); // a string, as injected via self.COOKIE

	assert.equal(
		restored.getCookies(new URL("https://example.com/"), false),
		"sess=xyz"
	);
});

test("a dotless domain from loaded data is still domain-checked", () => {
	const store = new CookieStore();
	// simulate an externally produced jar entry whose domain lacks the
	// leading dot setCookies normally adds
	store.load(
		JSON.stringify({
			"example.com@/@a": {
				name: "a",
				value: "1",
				domain: "example.com",
				path: "/",
			},
		})
	);

	assert.equal(store.getCookies(new URL("https://example.com/"), false), "a=1");
	assert.equal(
		store.getCookies(new URL("https://sub.example.com/"), false),
		"a=1"
	);
	// without the guard this leaked to every host
	assert.equal(store.getCookies(new URL("https://evil.com/"), false), "");
	assert.equal(store.getCookies(new URL("https://notexample.com/"), false), "");
});

test("load normalizes legacy dotted-domain keys before later replacement", () => {
	const url = new URL("https://example.com/");
	const store = new CookieStore();
	store.load({
		".example.com@/@a": {
			name: "a",
			value: "old",
			domain: ".EXAMPLE.COM",
			path: "/",
		},
	});

	store.setCookies(["a=new; Domain=example.com; Path=/"], url);
	assert.equal(store.getCookies(url, false), "a=new");
	assert.equal(Object.keys(JSON.parse(store.dump())).length, 1);
});
