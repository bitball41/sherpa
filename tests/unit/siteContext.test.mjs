import assert from "node:assert/strict";
import test from "node:test";

import { isSameSiteContext } from "../../src/shared/security/siteContext.ts";

test("known same-site directives count as a same-site cookie context", () => {
	// "none" is an initiator-less top-level navigation (address bar, bookmark,
	// stripped referrer) — a first-party context that must still send Strict
	// cookies, so it counts as same-site here.
	for (const directive of ["none", "same-origin", "same-site"]) {
		assert.equal(isSameSiteContext(directive), true, directive);
	}

	assert.equal(isSameSiteContext("cross-site"), false);
});

test("unknown or empty directives fail closed as cross-site", () => {
	// The gate protects SameSite's CSRF guarantee, so anything unrecognized
	// must withhold cookies rather than send them on an unclassifiable request.
	for (const directive of ["", "invalid-directive", "CROSS-SITE", "same"]) {
		assert.equal(isSameSiteContext(directive), false, JSON.stringify(directive));
	}
});
