import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./helpers/srcResolver.mjs", import.meta.url);

const { rewriteSelectorText } = await import("../../src/shared/selectors.ts");
const { SHADOW_ATTRIBUTE_PREFIX, shadowedAttributeNames } =
	await import("../../src/shared/shadowAttributes.ts");

const shadow = (body) => `:is([${SHADOW_ATTRIBUTE_PREFIX}${body}],[${body}])`;

test("leaves selectors without attribute selectors untouched", () => {
	for (const selector of [
		"",
		".foo",
		"#bar > span",
		"div:nth-child(2n + 1)",
		"a:hover::after",
	]) {
		assert.equal(rewriteSelectorText(selector), selector);
	}
});

test("points a rewritten attribute at its shadow copy", () => {
	assert.equal(
		rewriteSelectorText('a[href^="/help/"]'),
		`a${shadow('href^="/help/"')}`
	);
});

test("keeps the operator instead of loosening it", () => {
	// The old approach turned `^=` into `*=`, which could not work at all with
	// the default codec: the rewritten value is percent-encoded, so it does not
	// contain the site's URL as a substring either.
	assert.equal(
		rewriteSelectorText('img[src$=".svg"]'),
		`img${shadow('src$=".svg"')}`
	);
	assert.equal(rewriteSelectorText("[href]"), shadow("href"));
	assert.equal(
		rewriteSelectorText('link[imagesrcset~="x"]'),
		`link${shadow('imagesrcset~="x"')}`
	);
});

test("rewrites every attribute selector in a selector list", () => {
	assert.equal(
		rewriteSelectorText('a[href^="https://x"], img[src^="https://y"]'),
		`a${shadow('href^="https://x"')}, img${shadow('src^="https://y"')}`
	);
});

test("rewrites attribute selectors with no leading type selector", () => {
	assert.equal(
		rewriteSelectorText('[action="/login"] input'),
		`${shadow('action="/login"')} input`
	);
});

test("rewrites attribute selectors nested inside functional pseudo-classes", () => {
	assert.equal(
		rewriteSelectorText(':not([href^="#"])'),
		`:not(${shadow('href^="#"')})`
	);
	assert.equal(
		rewriteSelectorText('li:has(> a[href$=".pdf"])'),
		`li:has(> a${shadow('href$=".pdf"')})`
	);
});

test("preserves the case-sensitivity flag", () => {
	assert.equal(
		rewriteSelectorText('a[href^="/A/" i]'),
		`a${shadow('href^="/A/" i')}`
	);
	assert.equal(
		rewriteSelectorText("a[href^=/A/ s]"),
		`a${shadow("href^=/A/ s")}`
	);
});

test("normalizes whitespace between the bracket and the attribute name", () => {
	assert.equal(
		rewriteSelectorText('a[ href = "/x" ]'),
		`a${shadow('href = "/x" ')}`
	);
});

test("handles unquoted values", () => {
	assert.equal(
		rewriteSelectorText("form[action=/submit]"),
		`form${shadow("action=/submit")}`
	);
});

test("leaves attributes Sherpa never rewrites alone", () => {
	for (const selector of [
		'div[data-href^="/x"]',
		'input[type="checkbox"]',
		"[class]",
		'a[aria-label="Home"]',
	]) {
		assert.equal(rewriteSelectorText(selector), selector);
	}
});

test("leaves namespaced attribute selectors alone", () => {
	assert.equal(rewriteSelectorText("[xlink|href]"), "[xlink|href]");
	assert.equal(rewriteSelectorText("[*|href]"), "[*|href]");
});

test("rewrites an escaped colon attribute name and keeps the escape", () => {
	assert.equal(
		rewriteSelectorText("image[xlink\\:href]"),
		`image:is([${SHADOW_ATTRIBUTE_PREFIX}xlink\\:href],[xlink\\:href])`
	);
});

test("does not touch a bracket inside a string", () => {
	assert.equal(
		rewriteSelectorText('a[title="[href^=x]"]'),
		'a[title="[href^=x]"]'
	);
});

test("rewrites a value that itself contains a bracket", () => {
	assert.equal(
		rewriteSelectorText('a[href*="[0]"]'),
		`a${shadow('href*="[0]"')}`
	);
});

test("leaves malformed attribute selectors for the browser to reject", () => {
	for (const selector of ["a[href", "a[]", "a[href!=x]", "a[href^x]"]) {
		assert.equal(rewriteSelectorText(selector), selector);
	}
});

test("covers every attribute name the html rules can rewrite", () => {
	// A rule added to `htmlRules` without a matching entry in the standalone
	// list would silently stop being visible to selectors.
	for (const name of ["href", "src", "srcset", "action", "style", "target"]) {
		assert.ok(shadowedAttributeNames.has(name), name);
		assert.equal(rewriteSelectorText(`[${name}="x"]`), shadow(`${name}="x"`));
	}
});
