import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./helpers/srcResolver.mjs", import.meta.url);

/**
 * An in-memory stand-in for `CacheStorage`, faithful to the parts the engine
 * uses: insertion-ordered keys, URL-string request coercion, and `match`
 * returning a fresh `Response` each time.
 */
class FakeCache {
	entries = new Map();

	async match(request) {
		const stored = this.entries.get(String(request));
		if (!stored) return undefined;

		return new Response(stored.body, {
			status: stored.status,
			statusText: stored.statusText,
			headers: new Headers(stored.headers),
		});
	}

	async put(request, response) {
		const body = await response.arrayBuffer();
		const key = String(request);
		// `Cache.put` replaces in place, keeping the entry's original position.
		this.entries.set(key, {
			body,
			status: response.status,
			statusText: response.statusText,
			headers: [...response.headers],
		});
	}

	async keys() {
		return [...this.entries.keys()];
	}

	async delete(request) {
		return this.entries.delete(String(request));
	}
}

class FakeCacheStorage {
	caches = new Map();
	opened = [];

	async open(name) {
		this.opened.push(name);
		let cache = this.caches.get(name);
		if (!cache) {
			cache = new FakeCache();
			this.caches.set(name, cache);
		}

		return cache;
	}

	async keys() {
		return [...this.caches.keys()];
	}

	async delete(name) {
		return this.caches.delete(name);
	}
}

const baseConfig = {
	prefix: "/sherpa/",
	globals: { wrapfn: "$sherpa$wrap" },
	files: { wasm: "/sherpa.wasm.wasm" },
	flags: { responseCache: true },
	siteFlags: {},
	errorPage: {},
	codec: {
		encode: "(url) => url",
		decode: "(url) => url",
	},
};

const { setConfig } = await import("../../src/shared/state.ts");
const cache = await import("../../src/worker/cache.ts");

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const httpDate = (ms) => new Date(ms).toUTCString();

function install(config = baseConfig) {
	globalThis.caches = new FakeCacheStorage();
	setConfig(structuredClone(config));

	return globalThis.caches;
}

async function reset() {
	await cache.clearResponseCache();
}

const KEY = "https://example.com/app.js?sherpa.cache=deadbeef";

test("a fresh entry round-trips body, status and headers", async () => {
	install();
	await reset();

	const stored = new Response("rewritten()", {
		status: 200,
		statusText: "OK",
		headers: {
			"content-type": "text/javascript",
			"cache-control": "max-age=600",
		},
	});
	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW + 600_000, mustRevalidate: false },
		stored,
		NOW
	);

	const hit = await cache.lookupCachedResponse(KEY, NOW + 1000);
	assert.ok(hit);
	assert.equal(hit.fresh, true);
	assert.equal(hit.response.status, 200);
	assert.equal(hit.response.headers.get("content-type"), "text/javascript");
	assert.equal(await hit.response.text(), "rewritten()");
});

test("the freshness bookkeeping never reaches the page", async () => {
	install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW + 600_000, mustRevalidate: false },
		new Response("x", { headers: { vary: "Accept-Encoding" } }),
		NOW
	);

	const hit = await cache.lookupCachedResponse(KEY, NOW);
	assert.ok(hit);
	assert.equal(hit.response.headers.get("sherpa-cache-expires"), null);
	assert.equal(hit.response.headers.get("sherpa-cache-stored"), null);
	// the variance is already baked into the key, so the copy the page gets
	// must not carry a Vary the browser could act on
	assert.equal(hit.response.headers.get("vary"), null);
});

test("an expired entry with a validator comes back stale, not missing", async () => {
	install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW, mustRevalidate: false },
		new Response("old", { headers: { etag: '"v1"' } }),
		NOW
	);

	const hit = await cache.lookupCachedResponse(KEY, NOW + 60_000);
	assert.ok(hit);
	assert.equal(hit.fresh, false);
	assert.equal(hit.etag, '"v1"');
});

test("an expired entry with nothing to revalidate is dropped", async () => {
	const storage = install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW, mustRevalidate: false },
		new Response("old"),
		NOW
	);

	assert.equal(await cache.lookupCachedResponse(KEY, NOW + 60_000), null);

	const bucket = [...storage.caches.values()][0];
	assert.equal(bucket.entries.size, 0);
});

test("a 304 serves the stored body and extends the freshness window", async () => {
	install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW, mustRevalidate: false },
		new Response("cached body", {
			headers: { etag: '"v1"', "content-type": "text/css" },
		}),
		NOW
	);

	const stale = await cache.lookupCachedResponse(KEY, NOW + 60_000);
	assert.ok(stale);
	assert.equal(stale.fresh, false);

	const served = await cache.refreshCachedResponse(
		KEY,
		stale,
		{
			"cache-control": "max-age=3600",
			date: httpDate(NOW + 60_000),
			// a 304's own content-length describes its empty body and must be
			// ignored, or the served response is truncated
			"content-length": "0",
		},
		NOW + 60_000
	);

	assert.equal(served.status, 200);
	assert.equal(served.headers.get("content-type"), "text/css");
	assert.equal(await served.text(), "cached body");

	// give the write-back a turn to settle before reading it back
	await new Promise((resolve) => setTimeout(resolve, 0));
	const refreshed = await cache.lookupCachedResponse(KEY, NOW + 120_000);
	assert.ok(refreshed);
	assert.equal(refreshed.fresh, true);
	assert.equal(await refreshed.response.text(), "cached body");
});

test("a changed configuration starts from an empty bucket", async () => {
	const storage = install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW + 600_000, mustRevalidate: false },
		new Response("built under the old prefix"),
		NOW
	);
	assert.ok(await cache.lookupCachedResponse(KEY, NOW));

	// same CacheStorage, different config: output rewritten under the old
	// prefix must not be served under the new one
	setConfig({ ...structuredClone(baseConfig), prefix: "/other/" });

	assert.equal(await cache.lookupCachedResponse(KEY, NOW), null);
	// and the superseded bucket is reclaimed rather than left behind
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(storage.caches.size, 1);
});

test("the bucket is trimmed once it grows past its ceiling", async () => {
	const storage = install();
	await reset();

	const policy = { expiresAt: NOW + 600_000, mustRevalidate: false };
	for (let i = 0; i < 560; i++) {
		// eslint-disable-next-line no-await-in-loop
		await cache.storeCachedResponse(
			`https://example.com/asset-${i}?sherpa.cache=x`,
			policy,
			new Response(`body ${i}`),
			NOW
		);
	}

	const bucket = [...storage.caches.values()][0];
	assert.ok(
		bucket.entries.size <= 500,
		`expected the bucket to stay bounded, saw ${bucket.entries.size}`
	);
	// eviction is oldest-first, so the most recent writes have to survive
	assert.ok(
		await cache.lookupCachedResponse(
			"https://example.com/asset-559?sherpa.cache=x",
			NOW
		)
	);
});

test("an oversized body is not stored", async () => {
	const storage = install();
	await reset();

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW + 600_000, mustRevalidate: false },
		new Response("x".repeat(6 * 1024 * 1024)),
		NOW
	);

	const bucket = storage.caches.size ? [...storage.caches.values()][0] : null;
	assert.equal(bucket ? bucket.entries.size : 0, 0);
});

test("a missing CacheStorage degrades to no caching instead of throwing", async () => {
	await reset();
	delete globalThis.caches;
	setConfig(structuredClone(baseConfig));

	await cache.storeCachedResponse(
		KEY,
		{ expiresAt: NOW + 600_000, mustRevalidate: false },
		new Response("x"),
		NOW
	);
	assert.equal(await cache.lookupCachedResponse(KEY, NOW), null);
});
