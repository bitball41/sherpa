import assert from "node:assert/strict";
import test from "node:test";

import {
	appendUrlParams,
	decodeProxyUrl,
	encodeProxyUrl,
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
