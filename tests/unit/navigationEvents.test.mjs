import assert from "node:assert/strict";
import test from "node:test";

import { NavigateEvent } from "../../src/client/events.ts";

test("navigation listeners can cancel a navigation", () => {
	const event = new NavigateEvent("https://example.com/");

	assert.equal(event.cancelable, true);
	assert.equal(event.preventDefault(), undefined);
	assert.equal(event.defaultPrevented, true);
});
