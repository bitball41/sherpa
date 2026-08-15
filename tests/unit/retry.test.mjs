import assert from "node:assert/strict";
import test from "node:test";

import {
	isRetryableHttp2GoAway,
	isRetryableTransportError,
	retryTransientHttp2Request,
} from "../../src/worker/retry.ts";

test("HTTP/2 GOAWAY(NO_ERROR) is still retried", () => {
	const error = new Error(
		"http2 error: remote GOAWAY received with error NO_ERROR"
	);
	assert.equal(isRetryableHttp2GoAway(error), true);
	assert.equal(isRetryableTransportError(error), true);
});

test("common transport failures are retried once on bodyless GET", async () => {
	const cases = [
		new TypeError("Failed to fetch"),
		new Error("NetworkError when attempting to fetch resource"),
		new Error("connection reset by peer"),
		new Error("ECONNRESET"),
		new Error("tls handshake failed: connection closed"),
		new Error("wisp websocket closed unexpectedly"),
	];
	for (const error of cases) {
		assert.equal(isRetryableTransportError(error), true, String(error));
		let attempts = 0;
		const result = await retryTransientHttp2Request(
			() => {
				attempts++;
				if (attempts === 1) throw error;

				return "ok";
			},
			"GET",
			false
		);
		assert.equal(result, "ok");
		assert.equal(attempts, 2, String(error));
	}
});

test("POST and requests with a body are never retried", async () => {
	await assert.rejects(
		() =>
			retryTransientHttp2Request(
				() => {
					throw new TypeError("Failed to fetch");
				},
				"POST",
				false
			),
		/Failed to fetch/
	);
	await assert.rejects(
		() =>
			retryTransientHttp2Request(
				() => {
					throw new TypeError("Failed to fetch");
				},
				"GET",
				true
			),
		/Failed to fetch/
	);
});

test("permanent failures are not retried", async () => {
	assert.equal(isRetryableTransportError(new Error("404 not found")), false);
	assert.equal(
		isRetryableTransportError(new Error("CORS origin denied")),
		false
	);
	assert.equal(isRetryableTransportError(new Error("ENOTFOUND host")), false);
	let attempts = 0;
	await assert.rejects(
		() =>
			retryTransientHttp2Request(
				() => {
					attempts++;
					throw new Error("404 not found");
				},
				"GET",
				false
			),
		/404/
	);
	assert.equal(attempts, 1);
});
