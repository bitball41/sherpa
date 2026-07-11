import assert from "node:assert/strict";
import test from "node:test";

import { rewriteRefresh } from "../../src/shared/rewriters/refresh.ts";

const rewrite = (url) => `proxy:${url}`;

test("rewrites the url of a refresh directive and keeps the delay", () => {
	assert.equal(
		rewriteRefresh("5; url=https://example.com/next", rewrite),
		"5; url=proxy:https://example.com/next"
	);
});

test("matches the url key case-insensitively", () => {
	assert.equal(
		rewriteRefresh("0; URL=https://example.com/x", rewrite),
		"0; URL=proxy:https://example.com/x"
	);
});

test("preserves single and double quotes around the url", () => {
	assert.equal(
		rewriteRefresh(`0; url="https://example.com/a"`, rewrite),
		`0; url="proxy:https://example.com/a"`
	);
	assert.equal(
		rewriteRefresh("0; url='https://example.com/b'", rewrite),
		"0; url='proxy:https://example.com/b'"
	);
});

test("tolerates whitespace around the equals sign", () => {
	assert.equal(
		rewriteRefresh("0; url =  https://example.com/c", rewrite),
		"0; url =  proxy:https://example.com/c"
	);
});

test("leaves a delay-only directive untouched", () => {
	assert.equal(rewriteRefresh("10", rewrite), "10");
	assert.equal(rewriteRefresh("", rewrite), "");
});

test("stops a quoted url at its closing quote (trailing junk is dropped)", () => {
	// Matches the long-standing <meta http-equiv=refresh> behavior: once a
	// quote opens the value, parsing ends at the matching quote.
	assert.equal(
		rewriteRefresh(`3;url="https://example.com/d"; extra`, rewrite),
		`3;url="proxy:https://example.com/d"`
	);
});
