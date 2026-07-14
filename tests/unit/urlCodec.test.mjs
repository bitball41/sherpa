import assert from "node:assert/strict";
import test from "node:test";

import {
	appendUrlParamEntries,
	appendUrlParams,
	decodeProxyUrl,
	encodeProxyUrl,
	extractUrlParams,
	resolveBaseHref,
} from "../../src/shared/urlCodec.ts";

const encode = encodeURIComponent;
const decode = decodeURIComponent;

test("proxy URL codec round-trips fragments independently", () => {
	const original = new URL("https://example.com/a?x=1#percent%25-and-#");
	const originalHref = original.href;
	const encoded = encodeProxyUrl(original, "/sherpa/", encode);

	assert.equal(decodeProxyUrl(encoded, "/sherpa/", decode), originalHref);
	assert.equal(
		original.href,
		originalHref,
		"encoding must not mutate URL objects"
	);
});

test("decodeProxyUrl accepts absolute prefixes and preserves bare URLs", () => {
	const real = "https://example.com/path#hash";
	const encoded = encodeProxyUrl(new URL(real), "/sherpa/", encode);
	const absolute = `https://proxy.test${encoded}`;

	assert.equal(
		decodeProxyUrl(absolute, "https://proxy.test/sherpa/", decode),
		real
	);
	assert.equal(
		decodeProxyUrl(real, "https://proxy.test/sherpa/", decode),
		real
	);
});

test("decodeProxyUrl passes embedded blob and data URLs through", () => {
	assert.equal(
		decodeProxyUrl("/sherpa/BLOB:https://proxy.test/id", "/sherpa/", decode),
		"BLOB:https://proxy.test/id"
	);
	assert.equal(
		decodeProxyUrl("/sherpa/data:text/plain,hello", "/sherpa/", decode),
		"data:text/plain,hello"
	);
});

test("internal URL metadata is marked and extracted before fragments", () => {
	const original = "https://proxy.test/sherpa/encoded?scope=target#section";
	const proxied = appendUrlParams(original, {
		dest: "serviceworker",
		scope: "/app/",
	});

	assert.equal(proxied.endsWith("#section"), true);
	assert.match(proxied, /__sherpa_meta__/);
	assert.match(proxied, /[?&]dest=serviceworker(?:&|#|$)/);
	assert.deepEqual(
		{
			...extractUrlParams(proxied),
			params: { ...extractUrlParams(proxied).params },
		},
		{
			url: original,
			params: { dest: "serviceworker", scope: "/app/" },
		}
	);
});

test("internal metadata cannot collide with identity-codec target queries", () => {
	const original =
		"https://proxy.test/sherpa/https://target.test/?type=user&from=page";
	const proxied = appendUrlParams(original, {
		dest: "worker",
		type: "module",
	});
	const extracted = extractUrlParams(proxied);

	assert.equal(extracted.url, original);
	assert.deepEqual(
		{ ...extracted.params },
		{ dest: "worker", type: "module" }
	);
});

test("malformed or absent metadata is preserved instead of destructively parsed", () => {
	const plain = "https://proxy.test/sherpa/value?type=user";
	assert.deepEqual(extractUrlParams(plain), { url: plain, params: null });

	const malformed = `${plain}&__sherpa_meta__=%7Bbad&type=module`;
	assert.deepEqual(extractUrlParams(malformed), {
		url: malformed,
		params: null,
	});
});

test("relative HTML base URLs resolve from the document directory", () => {
	const documentUrl = new URL("https://example.com/a/page.html");

	assert.equal(
		resolveBaseHref("assets/", documentUrl)?.href,
		"https://example.com/a/assets/"
	);
	assert.equal(
		resolveBaseHref("/assets/", documentUrl)?.href,
		"https://example.com/assets/"
	);
	assert.equal(resolveBaseHref("http://[", documentUrl), null);
});

test("restoring form parameters preserves duplicate names and order", () => {
	const url = new URL("https://example.com/search");
	appendUrlParamEntries(url, [
		["tag", "first"],
		["tag", "second"],
		["page", "1"],
	]);

	assert.deepEqual(url.searchParams.getAll("tag"), ["first", "second"]);
	assert.equal(url.search, "?tag=first&tag=second&page=1");
});
