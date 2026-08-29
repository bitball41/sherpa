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

test("Cache.addAll mapping preserves frozen caller inputs and generic iterables", () => {
	const frozen = Object.freeze(["/a", "/b"]);
	assert.deepEqual(mapCacheRequestSequence(frozen, (value) => `proxy:${value}`), [
		"proxy:/a",
		"proxy:/b",
	]);
	assert.deepEqual(frozen, ["/a", "/b"]);
	assert.deepEqual(
		mapCacheRequestSequence(new Set(["/a", "/b"]), (value) => `proxy:${value}`),
		["proxy:/a", "proxy:/b"]
	);
});

test("Cache.addAll mapping rejects non-iterable input", () => {
	assert.throws(
		() => mapCacheRequestSequence({ 0: "/a", length: 1 }, (value) => value),
		TypeError
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
