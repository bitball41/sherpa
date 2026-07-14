import assert from "node:assert/strict";
import test from "node:test";

import { mergeConfig } from "../../src/shared/config.ts";

const base = {
	prefix: "/sherpa/",
	globals: { wrapfn: "$wrap", importfn: "$import" },
	files: { all: "/all.js", wasm: "/all.wasm", sync: "/sync.js" },
	flags: { serviceworkers: false, sourcemaps: true },
	siteFlags: { example: { sourcemaps: false } },
	errorPage: { title: "Uh oh!", accent: "blue" },
	codec: {
		encode: "encodeURIComponent",
		decode: "decodeURIComponent",
	},
};

test("mergeConfig preserves sibling values in partial nested updates", () => {
	const merged = mergeConfig(base, {
		flags: { serviceworkers: true },
		errorPage: { accent: "orange" },
	});

	assert.deepEqual(merged.flags, {
		serviceworkers: true,
		sourcemaps: true,
	});
	assert.deepEqual(merged.errorPage, {
		title: "Uh oh!",
		accent: "orange",
	});
	assert.deepEqual(base.flags, {
		serviceworkers: false,
		sourcemaps: true,
	});
});

test("mergeConfig serializes runtime codec updates", () => {
	const encode = (url) => `encoded:${url}`;
	const merged = mergeConfig(base, {
		codec: { encode, decode: decodeURIComponent },
	});

	assert.equal(merged.codec.encode, encode.toString());
	assert.equal(merged.codec.decode, decodeURIComponent.toString());
	assert.equal(typeof merged.codec.encode, "string");
});

test("mergeConfig preserves sibling flags for an updated site pattern", () => {
	const merged = mergeConfig(base, {
		siteFlags: {
			example: { serviceworkers: true },
		},
	});

	assert.deepEqual(merged.siteFlags.example, {
		sourcemaps: false,
		serviceworkers: true,
	});
	assert.deepEqual(base.siteFlags.example, { sourcemaps: false });
});

test("mergeConfig treats special site-pattern keys as data", () => {
	const siteFlags = JSON.parse(
		'{"__proto__":{"serviceworkers":true},"constructor":{"syncxhr":true}}'
	);
	const merged = mergeConfig(base, { siteFlags });

	assert.equal(Object.getPrototypeOf(merged.siteFlags), Object.prototype);
	assert.equal(
		Object.prototype.hasOwnProperty.call(merged.siteFlags, "__proto__"),
		true
	);
	assert.deepEqual(merged.siteFlags.__proto__, { serviceworkers: true });
	assert.deepEqual(merged.siteFlags.constructor, { syncxhr: true });
});
