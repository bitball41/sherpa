import assert from "node:assert/strict";
import test from "node:test";

import {
	createReferrerValue,
	selectReferrerPolicy,
} from "../../src/shared/referrerPolicy.ts";

test("Referrer-Policy selects the last recognized comma-separated token", () => {
	assert.equal(
		selectReferrerPolicy("origin, invalid-token, no-referrer"),
		"no-referrer"
	);
	assert.equal(selectReferrerPolicy("NO-REFERRER, unsafe-url"), "unsafe-url");
	assert.equal(selectReferrerPolicy("unknown, also-unknown"), null);
});

test("unsafe-url preserves the full referrer without credentials or fragments", () => {
	assert.equal(
		createReferrerValue(
			"unsafe-url",
			new URL("https://user:pass@example.com/path?q=1#fragment"),
			new URL("https://other.test/")
		),
		"https://example.com/path?q=1"
	);
});

test("strict-origin-when-cross-origin keeps paths only for same-origin requests", () => {
	const source = new URL("https://example.com/path?q=1#fragment");

	assert.equal(
		createReferrerValue(
			"strict-origin-when-cross-origin",
			source,
			new URL("https://example.com/next")
		),
		"https://example.com/path?q=1"
	);
	assert.equal(
		createReferrerValue(
			"strict-origin-when-cross-origin",
			source,
			new URL("https://other.test/")
		),
		"https://example.com/"
	);
	assert.equal(
		createReferrerValue(
			"strict-origin-when-cross-origin",
			source,
			new URL("http://other.test/")
		),
		null
	);
});

test("same-origin and origin-when-cross-origin apply their distinct rules", () => {
	const source = new URL("https://example.com/path");

	assert.equal(
		createReferrerValue("same-origin", source, new URL("https://other.test/")),
		null
	);
	assert.equal(
		createReferrerValue(
			"origin-when-cross-origin",
			source,
			new URL("https://other.test/")
		),
		"https://example.com/"
	);
});

test("every remaining policy handles origin, full URL, and downgrade cases", () => {
	const source = new URL("https://user:pass@example.com/path?q=1#hash");
	const crossOrigin = new URL("https://other.test/");
	const downgrade = new URL("http://other.test/");

	assert.equal(createReferrerValue("no-referrer", source, crossOrigin), null);
	assert.equal(
		createReferrerValue("no-referrer-when-downgrade", source, crossOrigin),
		"https://example.com/path?q=1"
	);
	assert.equal(
		createReferrerValue("no-referrer-when-downgrade", source, downgrade),
		null
	);
	assert.equal(
		createReferrerValue("origin", source, downgrade),
		"https://example.com/"
	);
	assert.equal(
		createReferrerValue("strict-origin", source, crossOrigin),
		"https://example.com/"
	);
	assert.equal(createReferrerValue("strict-origin", source, downgrade), null);
});
