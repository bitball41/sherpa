import assert from "node:assert/strict";
import test from "node:test";

import { isSameSiteContext } from "../../src/shared/security/siteContext.ts";

test("only cross-site requests fall outside the same-site cookie context", () => {
	// "none" is an initiator-less top-level navigation (address bar, bookmark,
	// stripped referrer) — a first-party context that must still send Strict
	// cookies, so it counts as same-site here.
	for (const directive of ["none", "same-origin", "same-site"]) {
		assert.equal(isSameSiteContext(directive), true, directive);
	}

	assert.equal(isSameSiteContext("cross-site"), false);
});
