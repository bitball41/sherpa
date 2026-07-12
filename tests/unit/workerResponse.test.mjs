import assert from "node:assert/strict";
import test from "node:test";

import {
	isHtmlContentType,
	isRedirectStatus,
	normalizeHtmlContentType,
} from "../../src/worker/response.ts";

test("recognizes only fetch redirect statuses", () => {
	for (const status of [301, 302, 303, 307, 308]) {
		assert.equal(isRedirectStatus(status), true, `${status}`);
	}
	for (const status of [300, 304, 305, 306, 309, 399]) {
		assert.equal(isRedirectStatus(status), false, `${status}`);
	}
});

test("matches HTML content types case-insensitively", () => {
	assert.equal(isHtmlContentType("Text/HTML; Charset=windows-1252"), true);
	assert.equal(isHtmlContentType("application/xhtml+xml"), false);
	assert.equal(isHtmlContentType(null), false);
});

test("normalizes plain and quoted HTML charsets to UTF-8", () => {
	assert.equal(normalizeHtmlContentType(), "text/html; charset=utf-8");
	assert.equal(
		normalizeHtmlContentType('Text/HTML; charset="windows-1252"; foo=bar'),
		"Text/HTML; charset=utf-8; foo=bar"
	);
	assert.equal(
		normalizeHtmlContentType("text/html; boundary=x"),
		"text/html; boundary=x; charset=utf-8"
	);
});
