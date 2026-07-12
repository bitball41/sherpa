import assert from "node:assert/strict";
import test from "node:test";

import { isIpAddress } from "../../src/shared/security/siteDomain.ts";

test("recognizes URL IP literals without confusing domain names", () => {
	for (const hostname of [
		"127.0.0.1",
		"192.168.1.10",
		"[::1]",
		"[2001:db8::1]",
	]) {
		assert.equal(isIpAddress(hostname), true, hostname);
	}
	for (const hostname of ["example.com", "1.2.3.example", "999.1.1.1"]) {
		assert.equal(isIpAddress(hostname), false, hostname);
	}
});
