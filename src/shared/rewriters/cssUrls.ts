// Quote-aware scanner for CSS `url()` tokens.
//
// This replaces the old `url\((['"]?)(.+?)(['"]?)\)` regex, which stopped at
// the first `)` even inside a quoted URL, so `url('/a(b).png')` was truncated
// to `/a(b` and the `.png')` tail leaked into the surrounding declaration. The
// regex also matched `url(...)` written inside CSS strings and comments (e.g.
// `content: "url(x)"`), where the text is not a URL at all, and never matched
// the case-insensitive `URL(` / `Url(` spellings the CSS grammar allows.
//
// The scanner walks the stylesheet once (a single linear pass, no
// backtracking), skipping string literals and comments so it only rewrites
// real `url()` functions, and consuming quoted values whole so inner `)`
// characters are preserved. Per the CSS syntax spec an unquoted url-token
// cannot contain an unescaped `)`, so only the quoted branch needs the
// paren-awareness the old regex lacked.

function isWhitespace(c: number): boolean {
	// CSS whitespace: space, tab, LF, CR, FF
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

// Characters that may appear in a CSS identifier. Used to make sure a `url(`
// match sits on an identifier boundary, so `bgurl(...)` isn't misread as the
// `url()` function.
function isIdentChar(c: number): boolean {
	return (
		(c >= 97 && c <= 122) || // a-z
		(c >= 65 && c <= 90) || // A-Z
		(c >= 48 && c <= 57) || // 0-9
		c === 45 || // -
		c === 95 || // _
		c >= 128 // non-ASCII (also covers escapes' worst case conservatively)
	);
}

// css[i] is `u`/`U`; return true if css[i..] begins a `url(` function token at
// an identifier boundary.
function isUrlFunc(css: string, i: number): boolean {
	if (
		(css.charCodeAt(i + 1) | 0x20) !== 114 /* r */ ||
		(css.charCodeAt(i + 2) | 0x20) !== 108 /* l */ ||
		css.charCodeAt(i + 3) !== 40 /* ( */
	)
		return false;

	return !isIdentChar(css.charCodeAt(i - 1));
}

// i points at the opening quote; return the index just past the closing quote
// (or the terminating newline / end of input for an unclosed string).
function skipString(css: string, i: number, quote: number): number {
	const n = css.length;
	i++; // past the opening quote
	while (i < n) {
		const c = css.charCodeAt(i);
		if (c === 92 /* \ */) {
			i += 2; // escape: skip the next char too
			continue;
		}
		if (c === quote) return i + 1;
		if (c === 10 /* \n */) return i; // raw newline ends a bad-string
		i++;
	}

	return n;
}

type UrlToken = { open: string; url: string; close: string; end: number };

// i points at the `u`/`U` of a confirmed `url(`. Parse the whole token,
// returning its inner URL plus the surrounding quote characters and the index
// just past the closing `)`, or null if it's empty or malformed (in which case
// the caller leaves the original text untouched).
function parseUrlToken(css: string, i: number): UrlToken | null {
	const n = css.length;
	let j = i + 4; // past "url("
	while (j < n && isWhitespace(css.charCodeAt(j))) j++;

	const q = css.charCodeAt(j);
	if (q === 34 /* " */ || q === 39 /* ' */) {
		const start = j + 1;
		let k = start;
		while (k < n) {
			const c = css.charCodeAt(k);
			if (c === 92 /* \ */) {
				k += 2;
				continue;
			}
			if (c === q) break;
			if (c === 10 /* \n */) return null; // bad-string, not a real url()
			k++;
		}
		if (k >= n) return null; // unterminated string

		const url = css.slice(start, k);
		let m = k + 1;
		while (m < n && isWhitespace(css.charCodeAt(m))) m++;
		if (css.charCodeAt(m) !== 41 /* ) */) return null; // junk before `)`
		if (url.trim() === "") return null; // url("") — leave as-is

		const quote = String.fromCharCode(q);

		return { open: quote, url, close: quote, end: m + 1 };
	}

	// unquoted url-token: runs to the closing `)` (unescaped parens are not
	// permitted by the grammar, so the first `)` always ends it)
	let k = j;
	while (k < n) {
		const c = css.charCodeAt(k);
		if (c === 92 /* \ */) {
			k += 2;
			continue;
		}
		if (c === 41 /* ) */) break;
		k++;
	}
	if (k >= n) return null; // unterminated

	const url = css.slice(j, k);
	if (url.trim() === "") return null; // url() — leave as-is

	return { open: "", url, close: "", end: k + 1 };
}

/**
 * Rewrite every real `url()` token in a stylesheet, leaving `url(...)` text
 * that appears inside CSS strings or comments untouched. `replace` receives the
 * raw inner URL (contents between the quotes, or the bare token) and returns its
 * replacement; the surrounding `url(` , quotes, and `)` are rebuilt by the
 * scanner.
 */
export function rewriteCssUrls(
	css: string,
	replace: (url: string) => string
): string {
	const n = css.length;
	let out = "";
	let last = 0; // start of the not-yet-flushed run of original text
	let i = 0;

	while (i < n) {
		const c = css.charCodeAt(i);

		if (c === 47 /* / */ && css.charCodeAt(i + 1) === 42 /* * */) {
			const end = css.indexOf("*/", i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}

		if (c === 34 /* " */ || c === 39 /* ' */) {
			i = skipString(css, i, c);
			continue;
		}

		if ((c === 117 || c === 85) /* u/U */ && isUrlFunc(css, i)) {
			const token = parseUrlToken(css, i);
			if (token) {
				out += css.slice(last, i);
				// css.slice(i, i + 4) is the original `url(` / `URL(` / `Url(` -
				// re-emit it verbatim so author casing is preserved
				out +=
					css.slice(i, i + 4) +
					token.open +
					replace(token.url) +
					token.close +
					")";
				i = token.end;
				last = i;
				continue;
			}
		}

		i++;
	}

	if (last === 0) return css; // nothing matched — return the original as-is
	out += css.slice(last);

	return out;
}
