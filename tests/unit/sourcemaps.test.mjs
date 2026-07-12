import assert from "node:assert/strict";
import test from "node:test";

import { decodeRewrites, RewriteType } from "../../src/shared/sourcemaps.ts";

function sourceMap(...rewrites) {
	const bytes = [];
	const uint32 = (value) => {
		bytes.push(value, value >>> 8, value >>> 16, value >>> 24);
	};
	uint32(rewrites.length);
	for (const rewrite of rewrites) {
		uint32(rewrite.start);
		uint32(rewrite.size);
		bytes.push(rewrite.type);
		if (rewrite.type === RewriteType.Replace) {
			const old = new TextEncoder().encode(rewrite.str);
			uint32(old.length);
			bytes.push(...old);
		}
	}

	return bytes;
}

test("decodes consecutive insert and replacement records", () => {
	const decoded = decodeRewrites(
		sourceMap(
			{ type: RewriteType.Replace, start: 2, size: 4, str: "old" },
			{ type: RewriteType.Insert, start: 10, size: 3 },
			{ type: RewriteType.Replace, start: 20, size: 2, str: "é" }
		)
	);

	assert.deepEqual(decoded, [
		{ type: RewriteType.Replace, start: 2, end: 6, str: "old" },
		{ type: RewriteType.Insert, start: 10, size: 3 },
		{ type: RewriteType.Replace, start: 20, end: 22, str: "é" },
	]);
});

test("rejects truncated and unknown source-map records", () => {
	assert.throws(() => decodeRewrites([1, 0, 0]), /truncated/);
	assert.throws(
		() => decodeRewrites(sourceMap({ type: 9, start: 0, size: 0 })),
		/unknown/
	);
});
