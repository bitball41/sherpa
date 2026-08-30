import assert from "node:assert/strict";
import test from "node:test";

import {
	contentTypeEssence,
	isHtmlContentType,
	isRedirectStatus,
	isSniffableHtmlContentType,
	looksLikeHtml,
	normalizeHtmlContentType,
	sniffHtml,
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
	assert.equal(contentTypeEssence(null), "");
	assert.equal(isSniffableHtmlContentType(null), true);
	assert.equal(isSniffableHtmlContentType(""), true);
	assert.equal(isSniffableHtmlContentType("application/octet-stream"), true);
	assert.equal(isSniffableHtmlContentType("text/plain"), false);
	assert.equal(isSniffableHtmlContentType("application/pdf"), false);
});

test("MIME-sniffs HTML vs binary from the first bytes", () => {
	const enc = new TextEncoder();
	assert.equal(looksLikeHtml(enc.encode("<!DOCTYPE html>")), true);
	assert.equal(looksLikeHtml(enc.encode("  \n<html lang=en>")), true);
	assert.equal(looksLikeHtml(enc.encode("<?xml version='1.0'?><html>")), true);
	assert.equal(looksLikeHtml(enc.encode("</head>")), true);
	assert.equal(
		looksLikeHtml(Uint8Array.of(0xef, 0xbb, 0xbf, 0x3c, 0x68, 0x74, 0x6d, 0x6c)),
		true
	);
	assert.equal(looksLikeHtml(enc.encode("%PDF-1.4")), false);
	assert.equal(looksLikeHtml(enc.encode("\x89PNG")), false);
	assert.equal(looksLikeHtml(enc.encode("")), false);
});

test("incomplete leading whitespace is not sniffed as binary yet", () => {
	const enc = new TextEncoder();
	assert.equal(sniffHtml(enc.encode("   \n\t"), false), "need-more");
	assert.equal(sniffHtml(enc.encode("   \n\t"), true), "binary");
	assert.equal(sniffHtml(enc.encode("<"), false), "need-more");
	assert.equal(sniffHtml(enc.encode("<html"), false), "html");
});

test("normalizes plain and quoted HTML charsets to UTF-8", () => {
	assert.equal(normalizeHtmlContentType(), "text/html; charset=utf-8");
	assert.equal(
		normalizeHtmlContentType("application/octet-stream"),
		"text/html; charset=utf-8"
	);
	assert.equal(
		normalizeHtmlContentType('Text/HTML; charset="windows-1252"; foo=bar'),
		"Text/HTML; charset=utf-8; foo=bar"
	);
	assert.equal(
		normalizeHtmlContentType("text/html; boundary=x"),
		"text/html; boundary=x; charset=utf-8"
	);
});
