import assert from "node:assert/strict";
import test from "node:test";

import { snapshotMeta } from "../../src/shared/urlMeta.ts";

// The client hands the rewriters a meta object whose `origin`/`base` are
// accessors. The HTML rewriter assigns to `base` when it meets a <base href>,
// and assigning to a getter-only property throws in strict mode - which used
// to abort the whole rewrite of any markup containing a <base> element.
function clientLikeMeta(href) {
	let reads = 0;

	return {
		meta: {
			get origin() {
				reads++;

				return new URL(href);
			},
			get base() {
				reads++;

				return new URL(href);
			},
			get topFrameName() {
				throw new Error("frame names are unavailable in this realm");
			},
			get parentFrameName() {
				throw new Error("frame names are unavailable in this realm");
			},
		},
		reads: () => reads,
	};
}

test("a snapshot of a getter-only meta accepts a new base", () => {
	const { meta } = clientLikeMeta("https://example.test/a/b");
	const snapshot = snapshotMeta(meta);

	assert.doesNotThrow(() => {
		snapshot.base = new URL("https://cdn.example.test/assets/");
	});
	assert.equal(snapshot.base.href, "https://cdn.example.test/assets/");

	// the original meta is untouched, so a <base> inside rewritten markup
	// cannot move the surrounding document's base
	assert.equal(meta.base.href, "https://example.test/a/b");
});

test("a snapshot reads each URL accessor exactly once", () => {
	const { meta, reads } = clientLikeMeta("https://example.test/a/b");

	const snapshot = snapshotMeta(meta);
	assert.equal(reads(), 2);

	for (let i = 0; i < 10; i++) {
		assert.equal(snapshot.base.href, "https://example.test/a/b");
		assert.equal(snapshot.origin.href, "https://example.test/a/b");
	}

	assert.equal(reads(), 2);
});

test("snapshotting does not touch the frame-name accessors", () => {
	const { meta } = clientLikeMeta("https://example.test/");

	// worker realms throw from these, so they have to stay lazy
	const snapshot = snapshotMeta(meta);
	assert.throws(() => snapshot.topFrameName, /unavailable/);
	assert.throws(() => snapshot.parentFrameName, /unavailable/);
});

test("frame names still follow the source meta", () => {
	const meta = {
		origin: new URL("https://example.test/"),
		base: new URL("https://example.test/"),
		topFrameName: "top-frame",
		parentFrameName: "parent-frame",
	};
	const snapshot = snapshotMeta(meta);

	assert.equal(snapshot.topFrameName, "top-frame");
	assert.equal(snapshot.parentFrameName, "parent-frame");
});
