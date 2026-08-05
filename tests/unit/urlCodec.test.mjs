import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./helpers/srcResolver.mjs", import.meta.url);

const {
	appendUrlParamEntries,
	appendUrlParams,
	decodeProxyUrl,
	encodeProxyUrl,
	resolveBaseHref,
	stripInternalParams,
} = await import("../../src/shared/urlCodec.ts");

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

test("appendUrlParams inserts internal parameters before fragments", () => {
	assert.equal(
		appendUrlParams("https://proxy.test/sherpa/encoded#section", {
			dest: "worker",
			type: "module",
		}),
		"https://proxy.test/sherpa/encoded?dest=worker&type=module#section"
	);
	assert.equal(
		appendUrlParams("https://proxy.test/sherpa/encoded?scope=%2Fapp%2F#x", {
			dest: "serviceworker",
		}),
		"https://proxy.test/sherpa/encoded?scope=%2Fapp%2F&dest=serviceworker#x"
	);
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

test("decoding strips sherpa's own query hints but keeps the site's", () => {
	// The hints are appended to the *proxied* URL in cleartext, after the
	// encoded target - exactly how the client builds a worker or module URL.
	const proxied = `/sherpa/${encode("https://example.com/w.js?id=3")}?sherpa.dest=worker&sherpa.type=module`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/w.js?id=3"
	);
});

test("a site parameter that merely looks internal is preserved", () => {
	const proxied = `/sherpa/${encode("https://example.com/a")}?sherpadest=1&other=2`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/a?sherpadest=1&other=2"
	);
});

test("stripping hints leaves the fragment alone", () => {
	assert.equal(
		stripInternalParams("https://example.com/a?sherpa.type=module#frag"),
		"https://example.com/a#frag"
	);
	assert.equal(
		stripInternalParams("https://example.com/a?x=1&sherpa.type=module#frag"),
		"https://example.com/a?x=1#frag"
	);
	// nothing internal: returned by identity, no re-serialization
	const untouched = "https://example.com/a?x=1&y=2#z";
	assert.equal(stripInternalParams(untouched), untouched);
	assert.equal(
		stripInternalParams("https://example.com/sherpa.js"),
		"https://example.com/sherpa.js"
	);
});
