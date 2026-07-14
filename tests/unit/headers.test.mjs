import assert from "node:assert/strict";
import test from "node:test";

import {
	flattenResponseHeaders,
	SherpaHeaders,
} from "../../src/shared/headers.ts";

test("request headers treat special property names as ordinary data", () => {
	const headers = new SherpaHeaders();

	headers.set("__proto__", "safe");
	headers.set("X-Test", "value");

	assert.equal(Object.getPrototypeOf(headers.headers), null);
	assert.equal(headers.headers.__proto__, "safe");
	assert.equal(headers.headers["x-test"], "value");
});

test("response headers combine lists while preserving singleton semantics", () => {
	const headers = flattenResponseHeaders({
		"referrer-policy": ["origin", "no-referrer"],
		location: ["https://first.test/", "https://second.test/"],
		"x-empty": [],
		"set-cookie": ["one=1", "two=2"],
	});

	assert.equal(Object.getPrototypeOf(headers), null);
	assert.equal(headers["referrer-policy"], "origin, no-referrer");
	assert.equal(headers.location, "https://first.test/");
	assert.equal("x-empty" in headers, false);
	assert.equal("set-cookie" in headers, false);
});
