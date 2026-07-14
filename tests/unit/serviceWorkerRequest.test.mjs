import assert from "node:assert/strict";
import test from "node:test";

import { createTransferredRequestInit } from "../../src/shared/serviceWorkerRequest.ts";

function metadata(overrides = {}) {
	return {
		body: null,
		headers: [["x-test", "value"]],
		method: "GET",
		mode: "cors",
		credentials: "include",
		cache: "no-store",
		redirect: "error",
		referrer: "https://proxy.test/sherpa/source",
		referrerPolicy: "origin",
		integrity: "",
		keepalive: true,
		...overrides,
	};
}

test("reconstructed requests preserve fetch-relevant internal slots", () => {
	const request = new Request(
		"https://proxy.test/sherpa/target",
		createTransferredRequestInit(metadata())
	);

	assert.equal(request.headers.get("x-test"), "value");
	assert.equal(request.mode, "cors");
	assert.equal(request.credentials, "include");
	assert.equal(request.cache, "no-store");
	assert.equal(request.redirect, "error");
	assert.equal(request.referrer, "https://proxy.test/sherpa/source");
	assert.equal(request.referrerPolicy, "origin");
	assert.equal(request.keepalive, true);
});

test("browser-only navigation mode falls back to a constructible internal mode", () => {
	const request = new Request(
		"https://proxy.test/sherpa/target",
		createTransferredRequestInit(metadata({ mode: "navigate" }))
	);

	assert.equal(request.mode, "same-origin");
});

test("stream bodies use duplex without constructing an invalid keepalive request", () => {
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("payload"));
			controller.close();
		},
	});
	const init = createTransferredRequestInit(
		metadata({ body, method: "POST", keepalive: true })
	);

	assert.equal(init.duplex, "half");
	assert.equal(init.keepalive, undefined);
	assert.doesNotThrow(
		() => new Request("https://proxy.test/sherpa/target", init)
	);
});
