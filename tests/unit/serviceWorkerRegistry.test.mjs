import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveServiceWorkerRegistrationUrls,
	ServiceWorkerRegistrationStore,
} from "../../src/shared/serviceWorkerRegistry.ts";

test("service worker URLs default scope to the script directory", () => {
	const result = resolveServiceWorkerRegistrationUrls(
		"./workers/site.js#ignored",
		undefined,
		"https://example.com/app/page.html"
	);

	assert.equal(
		result.scriptURL.href,
		"https://example.com/app/workers/site.js"
	);
	assert.equal(result.scopeURL.href, "https://example.com/app/workers/");
	assert.equal(result.scopePath, "/app/workers/");
});

test("service worker URL validation rejects origin and path escapes", () => {
	for (const [script, scope] of [
		["https://other.test/sw.js", undefined],
		["/sw.js", "https://other.test/"],
		["/encoded/%2f/sw.js", undefined],
		["/sw.js", "/scope/%5c/admin/"],
		["data:text/javascript,", undefined],
	]) {
		assert.throws(
			() =>
				resolveServiceWorkerRegistrationUrls(
					script,
					scope,
					"https://example.com/app/"
				),
			DOMException
		);
	}
});

test("service worker URL validation never widens unsupported scopes", () => {
	assert.throws(
		() =>
			resolveServiceWorkerRegistrationUrls(
				"/sw.js",
				"/app/?tenant=one",
				"https://example.com/"
			),
		(error) =>
			error instanceof DOMException && error.name === "NotSupportedError"
	);
});

test("registration matching selects the longest scope and preserves order", () => {
	const store = new ServiceWorkerRegistrationStore();
	store.set("https://example.com/", "root");
	store.set("https://example.com/app/", "app");
	store.set("https://other.test/app/", "foreign");

	assert.equal(store.match("https://example.com/app/page"), "app");
	assert.equal(store.match("https://example.com/elsewhere"), "root");
	assert.equal(store.match("https://unknown.test/"), undefined);
	assert.deepEqual(store.values(), ["root", "app", "foreign"]);
	assert.equal(store.delete("https://example.com/app/", "wrong"), false);
	assert.equal(store.delete("https://example.com/app/", "app"), true);
	assert.equal(store.match("https://example.com/app/page"), "root");
});
