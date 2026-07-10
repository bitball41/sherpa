/**
 * @fileoverview
 * Unit tests for the quote-aware CSS `url()` scanner (`rewriteCssUrls`).
 *
 * These are fixtures for the compat fix that replaced the old
 * `url\((['"]?)(.+?)(['"]?)\)` regex - see `KNOWN_ISSUES.md`. The scanner is
 * dependency-free, so it loads directly from TypeScript via Node's built-in
 * type stripping; run with `pnpm test:unit` (or `node --test tests/unit/`).
 *
 * A marker replacer `«...»` stands in for the real URL codec so the assertions
 * check the scanner's tokenization (which spans it rewrites, and the quotes it
 * preserves) rather than any particular URL encoding.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { rewriteCssUrls } = await import(
	"../../src/shared/rewriters/cssUrls.ts"
);

// Wrap each matched URL in guillemets so both the boundaries and the preserved
// quote characters are visible in the output.
const mark = (css) => rewriteCssUrls(css, (u) => `«${u}»`);

test("preserves an inner ) inside a single-quoted url (the core bug)", () => {
	assert.equal(mark(`a{background:url('/a(b).png')}`), `a{background:url('«/a(b).png»')}`);
});

test("preserves an inner ) inside a double-quoted url", () => {
	assert.equal(mark(`a{background:url("/x(y)z.png")}`), `a{background:url("«/x(y)z.png»")}`);
});

test("rewrites a bare unquoted url", () => {
	assert.equal(mark(`a{background:url(pic.png)}`), `a{background:url(«pic.png»)}`);
});

test("rewrites every candidate in a multi-value declaration", () => {
	assert.equal(
		mark(`.m{background:url(one.png),url('two.png'),url("three.png")}`),
		`.m{background:url(«one.png»),url('«two.png»'),url("«three.png»")}`
	);
});

test("does not rewrite url(...) written inside a string value", () => {
	assert.equal(mark(`.q{content:"url(not-a-url.png)"}`), `.q{content:"url(not-a-url.png)"}`);
});

test("does not rewrite url(...) written inside a comment", () => {
	assert.equal(
		mark(`/* url(in-comment.png) */ .z{color:red}`),
		`/* url(in-comment.png) */ .z{color:red}`
	);
});

test("matches the case-insensitive URL( spelling", () => {
	assert.equal(mark(`a{background:URL(pic.png)}`), `a{background:URL(«pic.png»)}`);
	assert.equal(mark(`a{background:Url('p.png')}`), `a{background:Url('«p.png»')}`);
});

test("does not treat an identifier ending in 'url' as the url() function", () => {
	assert.equal(mark(`a{--myurl:1;background:myurl(x)}`), `a{--myurl:1;background:myurl(x)}`);
});

test("leaves empty url() and url(\"\") untouched", () => {
	assert.equal(mark(`a{background:url()}`), `a{background:url()}`);
	assert.equal(mark(`a{background:url("")}`), `a{background:url("")}`);
	assert.equal(mark(`a{background:url(   )}`), `a{background:url(   )}`);
});

test("handles a data: URI with embedded commas and parens", () => {
	assert.equal(
		mark(`.x{background:url(data:image/svg+xml,<svg viewBox='0 0 1 1'><a(/></svg>)}`),
		`.x{background:url(«data:image/svg+xml,<svg viewBox='0 0 1 1'><a(/></svg>»)}`
	);
});

test("does not mistake a following format() for a url()", () => {
	assert.equal(
		mark(`@font-face{src:url(f.woff2) format("woff2")}`),
		`@font-face{src:url(«f.woff2») format("woff2")}`
	);
});

test("normalizes whitespace around a quoted value", () => {
	assert.equal(mark(`a{background:url(  "p.png"  )}`), `a{background:url("«p.png»")}`);
});

test("keeps an escaped ) inside an unquoted url", () => {
	assert.equal(mark(`a{background:url(a\\)b.png)}`), `a{background:url(«a\\)b.png»)}`);
});

test("returns the original string unchanged when there is nothing to rewrite", () => {
	const css = `.a{color:red;font:12px/1.5 sans-serif}`;
	assert.equal(mark(css), css);
});

test("leaves an unterminated url( ... alone", () => {
	assert.equal(mark(`a{background:url('unclosed`), `a{background:url('unclosed`);
});

test("rewrites url() inside @import url(...)", () => {
	assert.equal(mark(`@import url("theme.css");`), `@import url("«theme.css»");`);
});

test("rewrites a url() at the very start of the stylesheet", () => {
	// exercises the i === 0 identifier-boundary path
	assert.equal(mark(`url(x.png)`), `url(«x.png»)`);
	assert.equal(mark(`URL('y.png')`), `URL('«y.png»')`);
});

test("treats a raw newline (LF, CR, FF) in a quoted url as a bad-string", () => {
	// a raw newline inside the quotes is a CSS parse error, so it is not a valid
	// url() token and must be left exactly as-is
	for (const nl of ["\n", "\r", "\f"]) {
		const css = `a{background:url("bad${nl}value")}`;
		assert.equal(mark(css), css);
	}
});
