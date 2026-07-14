import assert from "node:assert/strict";
import test from "node:test";

import { base64ToBytes, bytesToBase64 } from "../../src/shared/base64.ts";

test("base64 helpers round-trip arbitrary bytes", () => {
	const source = Uint8Array.from(
		{ length: 100_000 },
		(_, index) => index % 251
	);
	const encoded = bytesToBase64(source);

	assert.deepEqual(base64ToBytes(encoded), source);
});

test("base64 helpers preserve UTF-8 payloads", () => {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const source = "Sherpa 🏔️ — café";

	assert.equal(
		decoder.decode(base64ToBytes(bytesToBase64(encoder.encode(source)))),
		source
	);
});
