import assert from "node:assert/strict";
import test from "node:test";

import {
	closeWebSocketOnAbort,
	normalizeWebSocketCloseArguments,
	normalizeWebSocketProtocols,
	resolveWebSocketUrl,
} from "../../src/shared/websocket.ts";

test("WebSocket URLs resolve from the virtual document and normalize schemes", () => {
	assert.equal(
		resolveWebSocketUrl("../socket?token=1", "https://example.com/app/page")
			.href,
		"wss://example.com/socket?token=1"
	);
	assert.equal(
		resolveWebSocketUrl("http://example.com/live", "https://unused.test/").href,
		"ws://example.com/live"
	);
});

test("WebSocket URL validation rejects unsupported schemes and every fragment", () => {
	assert.throws(
		() => resolveWebSocketUrl("ftp://example.com/", "https://example.com/"),
		(error) => error?.name === "SyntaxError"
	);
	assert.throws(
		() => resolveWebSocketUrl("/socket#", "https://example.com/"),
		(error) => error?.name === "SyntaxError"
	);
	assert.throws(
		() => resolveWebSocketUrl("/socket#room", "https://example.com/"),
		(error) => error?.name === "SyntaxError"
	);
});

test("protocol normalization accepts strings and iterable sequences", () => {
	assert.deepEqual(normalizeWebSocketProtocols(undefined), []);
	assert.deepEqual(normalizeWebSocketProtocols("chat"), ["chat"]);
	assert.deepEqual(
		normalizeWebSocketProtocols(new Set(["chat", "superchat"])),
		["chat", "superchat"]
	);
});

test("protocol normalization rejects empty, invalid, and duplicate tokens", () => {
	for (const protocols of [[""], ["has space"], ["chat", "chat"]]) {
		assert.throws(
			() => normalizeWebSocketProtocols(protocols),
			(error) => error?.name === "SyntaxError"
		);
	}
});

test("close argument validation keeps omitted values omitted", () => {
	assert.deepEqual(
		normalizeWebSocketCloseArguments(undefined, undefined, false, false),
		{ code: undefined, reason: undefined }
	);
	assert.deepEqual(
		normalizeWebSocketCloseArguments(1000.9, "done", true, true),
		{ code: 1000, reason: "done" }
	);
});

test("close argument validation rejects reserved codes and oversized reasons", () => {
	assert.throws(
		() => normalizeWebSocketCloseArguments(1001, undefined, true, false),
		(error) => error?.name === "InvalidAccessError"
	);
	assert.throws(
		() => normalizeWebSocketCloseArguments(3000, "🙂".repeat(31), true, true),
		(error) => error?.name === "SyntaxError"
	);
});


test("WebSocketStream abort handling covers pre-aborted and future signals", () => {
	const preAborted = new AbortController();
	preAborted.abort();
	let preAbortedCloses = 0;
	closeWebSocketOnAbort(preAborted.signal, () => preAbortedCloses++);
	assert.equal(preAbortedCloses, 1);

	const future = new AbortController();
	let futureCloses = 0;
	closeWebSocketOnAbort(future.signal, () => futureCloses++);
	assert.equal(futureCloses, 0);
	future.abort();
	future.abort();
	assert.equal(futureCloses, 1);

	const cleanedUp = new AbortController();
	let cleanedUpCloses = 0;
	const cleanup = closeWebSocketOnAbort(
		cleanedUp.signal,
		() => cleanedUpCloses++
	);
	cleanup();
	cleanedUp.abort();
	assert.equal(cleanedUpCloses, 0);
});
