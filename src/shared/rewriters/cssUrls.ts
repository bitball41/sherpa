// Quote-aware scanner for CSS resource references.
//
// CSS `url()` tokens and the bare string form of `@import` both carry URLs,
// but neither can be parsed safely with a regular expression: parentheses may
// occur inside quoted URLs, strings/comments can contain text that only looks
// like a reference, and CSS keywords are ASCII case-insensitive. This scanner
// walks the stylesheet once, skips non-code tokens, and optionally handles both
// reference forms in the same pass.

function isWhitespace(c: number): boolean {
	// CSS whitespace: space, tab, LF, CR, FF
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

function isNewline(c: number): boolean {
	return c === 10 /* \n */ || c === 13 /* \r */ || c === 12; /* \f */
}

function isIdentChar(c: number): boolean {
	return (
		(c >= 97 && c <= 122) || // a-z
		(c >= 65 && c <= 90) || // A-Z
		(c >= 48 && c <= 57) || // 0-9
		c === 45 || // -
		c === 92 || // CSS escape
		c === 95 || // _
		c >= 128
	);
}

function isUrlFunc(css: string, i: number): boolean {
	if (
		(css.charCodeAt(i + 1) | 0x20) !== 114 /* r */ ||
		(css.charCodeAt(i + 2) | 0x20) !== 108 /* l */ ||
		css.charCodeAt(i + 3) !== 40 /* ( */
	)
		return false;

	return i === 0 || !isIdentChar(css.charCodeAt(i - 1));
}

function isImportAtRule(css: string, i: number): boolean {
	if (css.charCodeAt(i) !== 64 /* @ */) return false;

	const keyword = "import";
	for (let j = 0; j < keyword.length; j++) {
		if ((css.charCodeAt(i + j + 1) | 0x20) !== keyword.charCodeAt(j)) {
			return false;
		}
	}

	return !isIdentChar(css.charCodeAt(i + keyword.length + 1));
}

// i points at the opening quote. Returns the index just past the closing quote
// or the raw newline/end that terminates a malformed string.
function skipString(css: string, i: number, quote: number): number {
	const n = css.length;
	i++;
	while (i < n) {
		const c = css.charCodeAt(i);
		if (c === 92 /* \\ */) {
			i += 2;
			continue;
		}
		if (c === quote) return i + 1;
		if (isNewline(c)) return i;
		i++;
	}

	return n;
}

type UrlToken = { open: string; url: string; close: string; end: number };

function parseUrlToken(css: string, i: number): UrlToken | null {
	const n = css.length;
	let j = i + 4;
	while (j < n && isWhitespace(css.charCodeAt(j))) j++;

	const q = css.charCodeAt(j);
	if (q === 34 /* " */ || q === 39 /* ' */) {
		const start = j + 1;
		let k = start;
		while (k < n) {
			const c = css.charCodeAt(k);
			if (c === 92 /* \\ */) {
				k += 2;
				continue;
			}
			if (c === q) break;
			if (isNewline(c)) return null;
			k++;
		}
		if (k >= n) return null;

		const url = css.slice(start, k);
		let m = k + 1;
		while (m < n && isWhitespace(css.charCodeAt(m))) m++;
		if (css.charCodeAt(m) !== 41 /* ) */ || url.trim() === "") return null;

		const quote = String.fromCharCode(q);

		return { open: quote, url, close: quote, end: m + 1 };
	}

	let k = j;
	while (k < n) {
		const c = css.charCodeAt(k);
		if (c === 92 /* \\ */) {
			k += 2;
			continue;
		}
		if (c === 41 /* ) */) break;
		k++;
	}
	if (k >= n) return null;

	const url = css.slice(j, k);
	if (url.trim() === "") return null;

	return { open: "", url, close: "", end: k + 1 };
}

type ImportToken = { url: string; start: number; end: number; next: number };

function parseImportToken(css: string, i: number): ImportToken | null {
	const n = css.length;
	let j = i + 7; // past `@import`

	// Comments are whitespace between an at-keyword and its first component.
	while (j < n) {
		while (j < n && isWhitespace(css.charCodeAt(j))) j++;
		if (css.charCodeAt(j) !== 47 || css.charCodeAt(j + 1) !== 42) break;
		const commentEnd = css.indexOf("*/", j + 2);
		if (commentEnd === -1) return null;
		j = commentEnd + 2;
	}

	const q = css.charCodeAt(j);
	if (q === 34 /* " */ || q === 39 /* ' */) {
		const next = skipString(css, j, q);
		if (next <= j + 1 || css.charCodeAt(next - 1) !== q) return null;

		const start = j + 1;
		const end = next - 1;
		const url = css.slice(start, end);
		if (url.trim() === "") return null;

		return { url, start, end, next };
	}

	// `@import url(...)` is handled by the normal url() path below. Retain the
	// legacy acceptance of an unquoted token for malformed-but-common CSS.
	if ((q === 117 || q === 85) && isUrlFunc(css, j)) return null;
	const start = j;
	while (
		j < n &&
		!isWhitespace(css.charCodeAt(j)) &&
		css.charCodeAt(j) !== 59 /* ; */
	)
		j++;
	if (j === start) return null;

	return { url: css.slice(start, j), start, end: j, next: j };
}

function scanCssReferences(
	css: string,
	replace: (url: string) => string,
	includeImports: boolean
): string {
	const n = css.length;
	let out = "";
	let last = 0;
	let i = 0;
	let blockDepth = 0;

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

		if (c === 123 /* { */) {
			blockDepth++;
			i++;
			continue;
		}
		if (c === 125 /* } */) {
			if (blockDepth > 0) blockDepth--;
			i++;
			continue;
		}

		if (includeImports && blockDepth === 0 && isImportAtRule(css, i)) {
			const token = parseImportToken(css, i);
			if (token) {
				out += css.slice(last, token.start) + replace(token.url);
				last = token.end;
				i = token.next;
				continue;
			}
		}

		if ((c === 117 || c === 85) /* u/U */ && isUrlFunc(css, i)) {
			const token = parseUrlToken(css, i);
			if (token) {
				out += css.slice(last, i);
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

	if (last === 0) return css;
	out += css.slice(last);

	return out;
}

/** Rewrite only real CSS `url()` tokens. */
export function rewriteCssUrls(
	css: string,
	replace: (url: string) => string
): string {
	return scanCssReferences(css, replace, false);
}

/** Rewrite `url()` tokens and top-level bare-string `@import` references. */
export function rewriteCssReferences(
	css: string,
	replace: (url: string) => string
): string {
	return scanCssReferences(css, replace, true);
}
