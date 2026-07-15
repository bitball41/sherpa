import assert from "node:assert/strict";
import test from "node:test";

import {
	mapCacheRequestSequence,
	matchNamespacedCaches,
	namespaceCacheName,
} from "../../src/shared/cacheNamespace.ts";

test("cache names are isolated by the full virtual-origin prefix", () => {
	assert.equal(
		namespaceCacheName("https://example.com@", "assets"),
		"https://example.com@assets"
	);
});

test("CacheStorage matching never visits another virtual origin", async () => {
	const visited = [];
	const response = await matchNamespacedCaches(
		[
			"https://other.test@private",
			"https://example.com@empty",
			"https://example.com@assets",
		],
		"https://example.com@",
		async (name) => {
			visited.push(name);
			return name.endsWith("@assets") ? "match" : undefined;
		}
	);

	assert.equal(response, "match");
	assert.deepEqual(visited, [
		"https://example.com@empty",
		"https://example.com@assets",
	]);
});

test("CacheStorage matching stops at the first result", async () => {
	const visited = [];
	const response = await matchNamespacedCaches(
		["origin@first", "origin@second"],
		"origin@",
		async (name) => {
			visited.push(name);
			return name;
		}
	);

	assert.equal(response, "origin@first");
	assert.deepEqual(visited, ["origin@first"]);
});

test("Cache.addAll request mapping does not mutate the caller's sequence", () => {
	const requests = Object.freeze(["/one", "/two"]);
	const mapped = mapCacheRequestSequence(requests, (request) => `proxy:${request}`);

	assert.deepEqual(mapped, ["proxy:/one", "proxy:/two"]);
	assert.deepEqual(requests, ["/one", "/two"]);
});

test("Cache.addAll request mapping accepts generic iterable sequences", () => {
	const mapped = mapCacheRequestSequence(
		new Set(["/one", "/two"]),
		(request) => `proxy:${request}`
	);

	assert.deepEqual(mapped, ["proxy:/one", "proxy:/two"]);
});

test("Cache.addAll request mapping rejects non-iterable values", () => {
	assert.throws(
		() => mapCacheRequestSequence({ length: 1, 0: "/one" }, String),
		/iterable/
	);
});
