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

// The helpers use the engine's Uint8Array.fromBase64/toBase64 where they
// exist and a JS fallback where they don't, so both have to agree with a
// known-good reference.
test("base64 helpers agree with a reference encoder", () => {
	const cases = [
		new Uint8Array(0),
		Uint8Array.from([0]),
		Uint8Array.from([0xff]),
		Uint8Array.from([1, 2]),
		Uint8Array.from([1, 2, 3]),
		Uint8Array.from([1, 2, 3, 4]),
		Uint8Array.from({ length: 999 }, (_, i) => (i * 7) % 256),
	];

	for (const bytes of cases) {
		const reference = Buffer.from(bytes).toString("base64");
		assert.equal(bytesToBase64(bytes), reference);
		assert.deepEqual(base64ToBytes(reference), bytes);
	}
});

test("base64 encoding covers only the given view of a buffer", () => {
	const backing = Uint8Array.from([0xaa, 0xbb, 1, 2, 3, 0xcc]);
	const view = backing.subarray(2, 5);

	assert.equal(bytesToBase64(view), Buffer.from([1, 2, 3]).toString("base64"));
});
