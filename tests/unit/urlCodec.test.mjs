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
	assert.equal(
		decodeProxyUrl(
			"/sherpa/blob:https://proxy.test/id?scramjet.dest=worker",
			"/sherpa/",
			decode
		),
		"blob:https://proxy.test/id"
	);
	assert.equal(
		decodeProxyUrl(
			"/sherpa/data:text/javascript,postMessage(1)?scramjet.type=module",
			"/sherpa/",
			decode
		),
		"data:text/javascript,postMessage(1)"
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

test("decoding strips the WASM leftover type=module hint", () => {
	const proxied = `/sherpa/${encode("https://example.com/mod.js?id=3")}?type=module`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/mod.js?id=3"
	);
});

test("decoding strips sherpa's own query hints but keeps the site's", () => {
	// The hints are appended to the *proxied* URL in cleartext, after the
	// encoded target - exactly how the client builds a worker or module URL.
	const proxied = `/sherpa/${encode("https://example.com/w.js?id=3")}?scramjet.dest=worker&scramjet.type=module`;

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
		stripInternalParams("https://example.com/a?scramjet.type=module#frag"),
		"https://example.com/a#frag"
	);
	assert.equal(
		stripInternalParams("https://example.com/a?x=1&scramjet.type=module#frag"),
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

test("a query appended to a proxied url replaces the target's own", () => {
	// This is what a GET form submission looks like from the outside: the
	// browser mutates the query of the action URL it was handed, which is the
	// *proxied* one. Per HTML that query replaces the action URL's own, so a
	// search box on a page already carrying `?q=` must read back `?q=new` and
	// not the `?q=old?q=new` that concatenating the two produced.
	const proxied = `/sherpa/${encode("https://example.com/search?q=old&page=2")}?q=new`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/search?q=new"
	);
});

test("an appended query survives alongside the fragment and sherpa's hints", () => {
	const proxied = `/sherpa/${encode("https://example.com/s?q=old")}?q=new&scramjet.type=module#${encode("frag")}`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/s?q=new#frag"
	);
});

test("an empty appended query clears the target's own", () => {
	const proxied = `/sherpa/${encode("https://example.com/s?q=old")}?`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/s"
	);
});

test("hints alone never disturb the target's own query", () => {
	const proxied = `/sherpa/${encode("https://example.com/w.js?id=3")}?scramjet.dest=worker`;

	assert.equal(
		decodeProxyUrl(proxied, "/sherpa/", decode),
		"https://example.com/w.js?id=3"
	);
});
