import assert from "node:assert/strict";
import test from "node:test";

import { rewriteImportMap } from "../../src/shared/rewriters/importMap.ts";

const mark = (url) => `proxy:${url}`;

test("rewrites top-level imports while preserving null and invalid entries", () => {
	const map = {
		imports: {
			app: "/app.js",
			blocked: null,
			invalid: 42,
		},
		custom: { untouched: true },
	};

	assert.equal(rewriteImportMap(map, mark), map);
	assert.deepEqual(map, {
		imports: {
			app: "proxy:/app.js",
			blocked: null,
			invalid: 42,
		},
		custom: { untouched: true },
	});
});

test("rewrites scope prefixes and every scoped target", () => {
	const map = {
		scopes: {
			"/app/": { lib: "./lib-v2.js", blocked: null },
			"https://cdn.test/": { lib: "https://cdn.test/lib.js" },
		},
	};

	rewriteImportMap(map, mark);
	assert.deepEqual(
		{ ...map.scopes },
		{
			"proxy:/app/": { lib: "proxy:./lib-v2.js", blocked: null },
			"proxy:https://cdn.test/": { lib: "proxy:https://cdn.test/lib.js" },
		}
	);
	assert.equal(Object.getPrototypeOf(map.scopes), null);
});

test("rewrites integrity URL keys without changing SRI metadata", () => {
	const map = JSON.parse(
		'{"integrity":{"/app.js":"sha384-one","__proto__":"sha384-two"}}'
	);

	rewriteImportMap(map, mark);
	assert.deepEqual(
		{ ...map.integrity },
		{
			"proxy:/app.js": "sha384-one",
			"proxy:__proto__": "sha384-two",
		}
	);
	assert.equal(Object.getPrototypeOf(map.integrity), null);
});

test("ignores non-object import-map sections and non-object roots", () => {
	const map = { imports: [], scopes: null, integrity: "invalid" };
	assert.equal(rewriteImportMap(map, mark), map);
	assert.deepEqual(map, { imports: [], scopes: null, integrity: "invalid" });
	assert.equal(rewriteImportMap(null, mark), null);
});
