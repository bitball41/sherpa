import assert from "node:assert/strict";
import test from "node:test";

import {
	readSyncResponse,
	writeSyncResponse,
} from "../../src/shared/syncResponse.ts";

test("sync response framing survives SharedArrayBuffer growth", () => {
	const sab = new SharedArrayBuffer(16, { maxByteLength: 16_384 });
	const headers = `x-large: ${"value".repeat(400)}\r\nx-unicode: café\r\n`;
	const body = Uint8Array.from({ length: 4_096 }, (_, index) => index % 251);

	writeSyncResponse(sab, 206, headers, body);

	assert.ok(sab.byteLength > 16);
	assert.equal(Atomics.load(new Uint8Array(sab, 0, 1), 0), 1);
	assert.deepEqual(readSyncResponse(sab), { status: 206, headers, body });
});

test("sync response framing records a complete empty failure", () => {
	const sab = new SharedArrayBuffer(16, { maxByteLength: 16 });

	writeSyncResponse(sab, 0, "", new Uint8Array());

	assert.deepEqual(readSyncResponse(sab), {
		status: 0,
		headers: "",
		body: new Uint8Array(),
	});
});

test("sync response decoding rejects truncated length fields", () => {
	const sab = new SharedArrayBuffer(16);
	const view = new DataView(sab);
	view.setUint32(3, 100);

	assert.throws(() => readSyncResponse(sab), /header length/);
});
