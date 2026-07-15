import assert from "node:assert/strict";
import test from "node:test";

import { withCurrentEvent } from "../../src/shared/currentEvent.ts";

test("current event is scoped to the callback and supports nested dispatch", () => {
	const native = { type: "native" };
	const target = Object.create({ event: native });
	const outer = { type: "outer" };
	const inner = { type: "inner" };

	withCurrentEvent(target, outer, () => {
		assert.equal(target.event, outer);
		withCurrentEvent(target, inner, () => {
			assert.equal(target.event, inner);
		});
		assert.equal(target.event, outer);
	});

	assert.equal(Object.hasOwn(target, "event"), false);
	assert.equal(target.event, native);
});

test("current event restoration survives listener exceptions", () => {
	const target = {};
	Object.defineProperty(target, "event", {
		value: "before",
		writable: true,
		configurable: true,
		enumerable: true,
	});
	const before = Object.getOwnPropertyDescriptor(target, "event");

	assert.throws(
		() =>
			withCurrentEvent(target, "during", () => {
				assert.equal(target.event, "during");
				throw new Error("listener failed");
			}),
		/listener failed/
	);

	assert.deepEqual(Object.getOwnPropertyDescriptor(target, "event"), before);
});
