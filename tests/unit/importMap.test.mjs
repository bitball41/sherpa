import assert from "node:assert/strict";
import test from "node:test";

import {
	isUrlLikeSpecifier,
	rewriteImportMap,
} from "../../src/shared/rewriters/importMap.ts";

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
		imports: Object.assign(Object.create(null), {
			app: "proxy:/app.js",
			blocked: null,
			invalid: 42,
		}),
		custom: { untouched: true },
	});
	assert.equal(Object.getPrototypeOf(map.imports), null);
});

test("rewrites URL-like specifier keys but preserves bare keys", () => {
	const map = {
		imports: {
			react: "/vendor/react.js",
			"/legacy/": "/modern/",
			"https://cdn.test/old.js": "https://cdn.test/new.js",
		},
	};

	rewriteImportMap(map, mark);
	assert.deepEqual(
		{ ...map.imports },
		{
			react: "proxy:/vendor/react.js",
			"proxy:/legacy/": "proxy:/modern/",
			"proxy:https://cdn.test/old.js": "proxy:https://cdn.test/new.js",
		}
	);
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
		Object.fromEntries(
			Object.entries(map.scopes).map(([scope, specifiers]) => [
				scope,
				{ ...specifiers },
			])
		),
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

test("classifies only path and valid-scheme specifiers as URLs", () => {
	for (const value of ["/x", "./x", "../x", "https://x.test", "node:fs"]) {
		assert.equal(isUrlLikeSpecifier(value), true, value);
	}
	for (const value of ["react", "@scope/pkg", "pkg/name:part", "1bad:x"]) {
		assert.equal(isUrlLikeSpecifier(value), false, value);
	}
});
