import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./helpers/srcResolver.mjs", import.meta.url);

const {
	CACHE_KEY_PARAM,
	cacheKeyUrl,
	canStoreResponseFor,
	canUseStoredResponse,
	isStorableVary,
	parseCacheControl,
	responseCachePolicy,
} = await import("../../src/shared/httpCache.ts");
const {
	INTERNAL_PARAM_PREFIX,
	isInternalParam,
} = await import("../../src/shared/internalParams.ts");

test("the cache key parameter lives in the internal namespace", () => {
	assert.ok(CACHE_KEY_PARAM.startsWith(INTERNAL_PARAM_PREFIX));
	assert.ok(isInternalParam(CACHE_KEY_PARAM));
});

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const httpDate = (ms) => new Date(ms).toUTCString();

test("cache-control directives are parsed case-insensitively", () => {
	const cc = parseCacheControl("Public, MAX-AGE=600, immutable");
	assert.equal(cc.get("max-age"), "600");
	assert.ok(cc.has("public"));
	assert.ok(cc.has("immutable"));
});

test("a comma inside a quoted directive value does not split the directive", () => {
	const cc = parseCacheControl('no-cache="set-cookie, x-token", max-age=30');
	assert.equal(cc.get("no-cache"), "set-cookie, x-token");
	assert.equal(cc.get("max-age"), "30");
});

test("an array-valued cache-control header is joined, not stringified", () => {
	const cc = parseCacheControl(["no-store", "max-age=5"]);
	assert.ok(cc.has("no-store"));
	assert.equal(cc.get("max-age"), "5");
});

test("only reproducible vary fields are storable", () => {
	assert.equal(isStorableVary(undefined), true);
	assert.equal(isStorableVary("Accept-Encoding"), true);
	assert.equal(isStorableVary("Accept, Accept-Language, Origin"), true);
	assert.equal(isStorableVary("*"), false);
	assert.equal(isStorableVary("Cookie"), false);
	assert.equal(isStorableVary("Accept-Encoding, User-Agent"), false);
});

test("max-age sets the freshness window", () => {
	const policy = responseCachePolicy(
		200,
		{ "cache-control": "max-age=600", date: httpDate(NOW) },
		NOW
	);
	assert.ok(policy);
	assert.equal(policy.expiresAt, NOW + 600_000);
});

test("an upstream Age is subtracted from the freshness window", () => {
	const policy = responseCachePolicy(
		200,
		{ "cache-control": "max-age=600", age: "540", date: httpDate(NOW) },
		NOW
	);
	assert.ok(policy);
	assert.equal(policy.expiresAt, NOW + 60_000);
});

test("a response already older than its max-age is dropped without a validator", () => {
	assert.equal(
		responseCachePolicy(
			200,
			{ "cache-control": "max-age=60", age: "600", date: httpDate(NOW) },
			NOW
		),
		null
	);
});

test("a response older than its max-age is kept when it can be revalidated", () => {
	const policy = responseCachePolicy(
		200,
		{
			"cache-control": "max-age=60",
			age: "600",
			date: httpDate(NOW),
			etag: '"abc"',
		},
		NOW
	);
	assert.ok(policy);
	assert.equal(policy.expiresAt, NOW);
});

test("Expires is used when no max-age is present", () => {
	const policy = responseCachePolicy(
		200,
		{ date: httpDate(NOW), expires: httpDate(NOW + 300_000) },
		NOW
	);
	assert.ok(policy);
	assert.equal(policy.expiresAt, NOW + 300_000);
});

test("max-age wins over Expires", () => {
	const policy = responseCachePolicy(
		200,
		{
			"cache-control": "max-age=60",
			date: httpDate(NOW),
			expires: httpDate(NOW + 300_000),
		},
		NOW
	);
	assert.ok(policy);
	assert.equal(policy.expiresAt, NOW + 60_000);
});

test("heuristic freshness is a tenth of the resource's age, capped at a day", () => {
	const tenDays = 10 * 24 * 60 * 60 * 1000;
	const policy = responseCachePolicy(
		200,
		{ date: httpDate(NOW), "last-modified": httpDate(NOW - tenDays) },
		NOW
	);
	assert.ok(policy);
	// a tenth of ten days is one day, which is exactly the cap
	assert.equal(policy.expiresAt, NOW + 24 * 60 * 60 * 1000);

	const hour = 60 * 60 * 1000;
	const short = responseCachePolicy(
		200,
		{ date: httpDate(NOW), "last-modified": httpDate(NOW - hour) },
		NOW
	);
	assert.ok(short);
	assert.equal(short.expiresAt, NOW + hour / 10);
});

test("no-store is never stored, in either direction", () => {
	assert.equal(
		responseCachePolicy(
			200,
			{ "cache-control": "no-store, max-age=600", etag: '"a"' },
			NOW
		),
		null
	);
	assert.equal(
		canUseStoredResponse(
			"default",
			new Headers({ "cache-control": "no-store" })
		),
		false
	);
});

test("no-cache stores only when there is something to revalidate with", () => {
	assert.equal(
		responseCachePolicy(200, { "cache-control": "no-cache" }, NOW),
		null
	);
	const policy = responseCachePolicy(
		200,
		{ "cache-control": "no-cache", etag: '"a"' },
		NOW
	);
	assert.ok(policy);
	// stored, but immediately stale: it can only ever be used after a 304
	assert.equal(policy.expiresAt, 0);
	assert.equal(policy.mustRevalidate, true);
});

test("a response that sets cookies is never replayed", () => {
	assert.equal(
		responseCachePolicy(
			200,
			{ "cache-control": "max-age=600", "set-cookie": ["session=1"] },
			NOW
		),
		null
	);
});

test("only 200 responses are stored", () => {
	for (const status of [204, 206, 301, 304, 404, 500]) {
		assert.equal(
			responseCachePolicy(status, { "cache-control": "max-age=600" }, NOW),
			null,
			`status ${status} must not be stored`
		);
	}
});

test("a response varying on something unreproducible is not stored", () => {
	assert.equal(
		responseCachePolicy(
			200,
			{ "cache-control": "max-age=600", vary: "Cookie" },
			NOW
		),
		null
	);
});

test("a malformed max-age is not guessed at", () => {
	// "max-age=none" and a negative delta-seconds are both invalid; falling back
	// to heuristic freshness (or to 0) is the only safe reading.
	assert.equal(
		responseCachePolicy(200, { "cache-control": "max-age=none" }, NOW),
		null
	);
	assert.equal(
		responseCachePolicy(200, { "cache-control": "max-age=-5" }, NOW),
		null
	);
});

test("documents may be stored; they are no longer banned at the request layer", () => {
	const headers = new Headers();
	assert.equal(canStoreResponseFor("GET", "document", headers), true);
	assert.equal(canStoreResponseFor("GET", "iframe", headers), true);
	assert.equal(canStoreResponseFor("GET", "script", headers), true);
	assert.equal(canStoreResponseFor("GET", "style", headers), true);
	assert.equal(canStoreResponseFor("GET", "image", headers), true);
	assert.equal(canStoreResponseFor("GET", "", headers), true);
});

test("documents skip heuristic freshness but still store for revalidation", () => {
	assert.equal(responseCachePolicy(200, {}, NOW, "document"), null);

	const lastModifiedOnly = responseCachePolicy(
		200,
		{ "last-modified": httpDate(NOW - 10 * 24 * 3600 * 1000) },
		NOW,
		"document"
	);
	assert.ok(lastModifiedOnly);
	assert.ok(
		lastModifiedOnly.expiresAt <= NOW,
		"Last-Modified alone must not invent a freshness window for HTML"
	);

	const scriptHeuristic = responseCachePolicy(
		200,
		{ "last-modified": httpDate(NOW - 10 * 24 * 3600 * 1000) },
		NOW,
		"script"
	);
	assert.ok(scriptHeuristic);
	assert.ok(scriptHeuristic.expiresAt > NOW);

	const explicit = responseCachePolicy(
		200,
		{ "cache-control": "max-age=60", date: httpDate(NOW) },
		NOW,
		"document"
	);
	assert.ok(explicit);
	assert.equal(explicit.expiresAt, NOW + 60_000);
});

test("only GET is stored", () => {
	const headers = new Headers();
	for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
		assert.equal(canStoreResponseFor(method, "script", headers), false);
	}
});

test("range, conditional and authorized requests bypass the cache", () => {
	assert.equal(
		canStoreResponseFor("GET", "video", new Headers({ range: "bytes=0-1023" })),
		false
	);
	assert.equal(
		canStoreResponseFor(
			"GET",
			"script",
			new Headers({ "if-none-match": '"a"' })
		),
		false
	);
	assert.equal(
		canStoreResponseFor(
			"GET",
			"script",
			new Headers({ authorization: "Bearer x" })
		),
		false
	);
});

test("the request's own cache mode decides whether a stored entry may be used", () => {
	const empty = new Headers();
	assert.equal(canUseStoredResponse("default", empty), true);
	assert.equal(canUseStoredResponse(undefined, empty), true);
	assert.equal(canUseStoredResponse("reload", empty), false);
	assert.equal(canUseStoredResponse("no-cache", empty), false);
	assert.equal(canUseStoredResponse("no-store", empty), false);
	assert.equal(
		canUseStoredResponse("default", new Headers({ pragma: "no-cache" })),
		false
	);
	assert.equal(
		canUseStoredResponse(
			"default",
			new Headers({ "cache-control": "max-age=0" })
		),
		false
	);
});

test("the cache key separates variants that rewrite differently", () => {
	const url = new URL("https://example.com/asset");
	const none = () => null;
	const asScript = cacheKeyUrl(url, "script", "", none);
	const asStyle = cacheKeyUrl(url, "style", "", none);
	const asModule = cacheKeyUrl(url, "script", "module", none);

	assert.notEqual(asScript, asStyle);
	assert.notEqual(asScript, asModule);
	assert.equal(asScript, cacheKeyUrl(url, "script", "", none));
	assert.ok(asScript.startsWith(`https://example.com/asset?${CACHE_KEY_PARAM}=`));
});

test("the cache key separates the request headers a response may vary on", () => {
	const url = new URL("https://example.com/a");
	const withOrigin = cacheKeyUrl(url, "script", "", (name) =>
		name === "origin" ? "https://a.example" : null
	);
	const otherOrigin = cacheKeyUrl(url, "script", "", (name) =>
		name === "origin" ? "https://b.example" : null
	);
	const noOrigin = cacheKeyUrl(url, "script", "", () => null);

	assert.notEqual(withOrigin, otherOrigin);
	assert.notEqual(withOrigin, noOrigin);
});

test("the cache key keeps the site's own query string intact", () => {
	const key = cacheKeyUrl(
		new URL("https://example.com/a?v=2&q=hi"),
		"script",
		"",
		() => null
	);
	const parsed = new URL(key);
	assert.equal(parsed.searchParams.get("v"), "2");
	assert.equal(parsed.searchParams.get("q"), "hi");
	assert.ok(parsed.searchParams.has(CACHE_KEY_PARAM));
});
