import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAssignment } from "../../src/shared/assignment.ts";

test("assignment evaluation preserves compound operator semantics", () => {
	assert.deepEqual(evaluateAssignment("https://example.com/", "+=", "next"), {
		assign: true,
		value: "https://example.com/next",
	});
	assert.deepEqual(evaluateAssignment(8, "**=", 2), {
		assign: true,
		value: 64,
	});
	assert.deepEqual(evaluateAssignment(8, ">>=", 1), {
		assign: true,
		value: 4,
	});
});

test("logical assignment reports whether a write is required", () => {
	assert.deepEqual(evaluateAssignment("current", "||=", "next"), {
		assign: false,
		value: "current",
	});
	assert.deepEqual(evaluateAssignment("current", "&&=", "next"), {
		assign: true,
		value: "next",
	});
	assert.deepEqual(evaluateAssignment(null, "??=", "next"), {
		assign: true,
		value: "next",
	});
});

test("unknown assignment operators fail closed", () => {
	assert.throws(() => evaluateAssignment(1, "=>", 2), /unsupported/);
});
