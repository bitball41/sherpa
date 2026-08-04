import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./helpers/srcResolver.mjs", import.meta.url);

const { persistCookieStore } =
	await import("../../src/worker/cookiePersistence.ts");

/**
 * Node has no `indexedDB`, so every write attempt fails and is swallowed with
 * a warning. That is what makes the coalescing observable from outside: one
 * warning per attempted store, and none of the failures escaping to the
 * caller.
 */
async function countStores(run) {
	const warn = console.warn;
	let stores = 0;
	console.warn = () => stores++;
	try {
		await run();
	} finally {
		console.warn = warn;
	}

	return stores;
}

const jar = { dump: () => '{"a":{"name":"a","domain":"example.com"}}' };

test("a burst of cookie writes collapses into a bounded number of stores", async () => {
	const stores = await countStores(async () => {
		const settled = [];
		for (let i = 0; i < 25; i++) settled.push(persistCookieStore(jar));
		await Promise.all(settled);
	});

	// One store for the burst, plus at most one more for whatever arrived while
	// it was in flight - not one per call, and never zero.
	assert.ok(
		stores >= 1 && stores <= 2,
		`expected 25 calls to collapse into 1-2 stores, saw ${stores}`
	);
});

test("the returned promise settles only after a store that saw the change", async () => {
	const first = await countStores(() => persistCookieStore(jar));
	assert.ok(first >= 1);

	// A later change starts a new cycle rather than reusing the settled one.
	const second = await countStores(() => persistCookieStore(jar));
	assert.ok(second >= 1);
});

test("a storage failure never rejects into the response path", async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		await assert.doesNotReject(() => persistCookieStore(jar));
	} finally {
		console.warn = warn;
	}
});
