import assert from "node:assert/strict";
import test from "node:test";

import {
	rewriteCssReferences,
	rewriteCssUrls,
} from "../../src/shared/rewriters/cssUrls.ts";

const markReferences = (css) => rewriteCssReferences(css, (url) => `«${url}»`);

test("rewrites string and URL forms of @import in one pass", () => {
	assert.equal(
		markReferences(`@import "theme.css"; @import url(print.css) print;`),
		`@import "«theme.css»"; @import url(«print.css») print;`
	);
});

test("matches case-insensitive imports and comments used as whitespace", () => {
	assert.equal(
		markReferences(`@IMPORT/* keep */'theme.css' layer(theme);`),
		`@IMPORT/* keep */'«theme.css»' layer(theme);`
	);
});

test("preserves import qualifiers and escaped quote text", () => {
	assert.equal(
		markReferences(`@import "a\\\"b.css" supports(display: grid) screen;`),
		`@import "«a\\\"b.css»" supports(display: grid) screen;`
	);
});

test("does not rewrite import-looking text in strings, comments, or blocks", () => {
	const css = [
		`/* @import "comment.css"; */`,
		`.x::before { content: '@import "string.css"'; }`,
		`@media print { @import "nested.css"; .x { background: url(real.png); } }`,
	].join("\n");

	assert.equal(
		markReferences(css),
		css.replace("url(real.png)", "url(«real.png»)")
	);
});

test("keeps the url-only API focused on url() tokens", () => {
	assert.equal(
		rewriteCssUrls(
			`@import "theme.css"; a{background:url(pic.png)}`,
			(url) => `«${url}»`
		),
		`@import "theme.css"; a{background:url(«pic.png»)}`
	);
});

test("rewrites imports longer than the old regex cutoff", () => {
	const url = `${"a".repeat(12_000)}.css`;
	assert.equal(markReferences(`@import "${url}";`), `@import "«${url}»";`);
});

test("does not confuse longer at-keywords with @import", () => {
	assert.equal(
		markReferences(`@important "not-a-url.css";`),
		`@important "not-a-url.css";`
	);
});
