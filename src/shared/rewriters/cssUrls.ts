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

// Characters that have to be escaped in each of the three forms a reference
// can be written in. Membership is tested with `indexOf` rather than one
// character-class regex: this runs for every reference in every stylesheet,
// almost always to answer "none of them", and a handful of `indexOf` scans
// (which the engine vectorizes) beat a regex that has to walk the string
// itself by about 2x.
const DOUBLE_QUOTED_UNSAFE = ["\\", '"', "\n", "\r", "\f"];
const SINGLE_QUOTED_UNSAFE = ["\\", "'", "\n", "\r", "\f"];
const UNQUOTED_UNSAFE = ["\\", '"', "'", "(", ")", " ", "\t", "\n", "\r", "\f"];

function containsAny(value: string, characters: readonly string[]): boolean {
	for (let i = 0; i < characters.length; i++)
		if (value.indexOf(characters[i]) !== -1) return true;

	return false;
}

function isHexDigit(c: number): boolean {
	return (
		(c >= 48 && c <= 57) || // 0-9
		(c >= 97 && c <= 102) || // a-f
		(c >= 65 && c <= 70) // A-F
	);
}

/**
 * Resolves the CSS escapes in a parsed reference, so the URL handed to the
 * rewriter is the one the author meant.
 *
 * `url('it\'s.png')` is an apostrophe in a URL, not a backslash followed by
 * one, and `\28` is `(`. Passing the raw text through instead fed the URL
 * parser a stray backslash - and, now that the output side escapes what it
 * writes, would have doubled the escape on every round trip.
 */
function decodeCssEscapes(value: string): string {
	let out = "";
	let i = 0;
	const n = value.length;

	while (i < n) {
		const c = value.charCodeAt(i);
		if (c !== 92 /* \ */) {
			out += value[i++];
			continue;
		}

		i++;
		if (i >= n) break; // a trailing solidus is dropped, per the tokenizer
		const next = value.charCodeAt(i);

		if (isHexDigit(next)) {
			let hex = "";
			while (i < n && hex.length < 6 && isHexDigit(value.charCodeAt(i)))
				hex += value[i++];
			// one whitespace after the digits terminates the escape
			if (i < n && isWhitespace(value.charCodeAt(i))) i++;
			const code = parseInt(hex, 16);
			out +=
				code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
					? "�"
					: String.fromCodePoint(code);
			continue;
		}

		// an escaped newline is a line continuation: it stands for nothing
		if (isNewline(next)) {
			i++;
			continue;
		}

		out += value[i++];
	}

	return out;
}

/** `decodeCssEscapes` for callers that have not already looked for a solidus. */
function decodeCssEscapesIfNeeded(value: string): string {
	return value.indexOf("\\") === -1 ? value : decodeCssEscapes(value);
}

function cssEscape(character: string): string {
	// A newline cannot be backslash-escaped literally: inside a string that is
	// a line continuation, which erases it. The hexadecimal escape (with the
	// trailing space that terminates it) is the form that preserves it.
	const code = character.charCodeAt(0);
	if (code < 0x20) return `\\${code.toString(16)} `;

	return `\\${character}`;
}

/**
 * Escapes a rewritten URL for the token it is being written back into.
 *
 * The replacement is not the string that was parsed out, and it is not
 * guaranteed to be safe there: `encodeURIComponent` - the default codec -
 * deliberately leaves `!'()*` alone, so a target URL containing an apostrophe
 * or a parenthesis came back out verbatim. Inside `url('...')` that apostrophe
 * closes the string early and the rest of the URL becomes stray CSS; inside an
 * unquoted `url(...)` a parenthesis or a space produces a bad-url token and the
 * browser drops the whole declaration.
 *
 * CSS escapes are the fix in both forms: a string may escape its own quote and
 * a backslash, and a url-token may escape any of the characters its grammar
 * forbids.
 */
function escapeCssUrl(value: string, quote: string): string {
	const unsafe = quote
		? quote === '"'
			? DOUBLE_QUOTED_UNSAFE
			: SINGLE_QUOTED_UNSAFE
		: UNQUOTED_UNSAFE;
	// The overwhelming majority of rewritten URLs need nothing done to them,
	// and this runs for every reference in every stylesheet.
	if (!containsAny(value, unsafe)) return value;

	let out = "";
	for (let i = 0; i < value.length; i++) {
		const character = value[i];
		out += unsafe.includes(character) ? cssEscape(character) : character;
	}

	return out;
}

function parseUrlToken(css: string, i: number): UrlToken | null {
	const n = css.length;
	let j = i + 4;
	while (j < n && isWhitespace(css.charCodeAt(j))) j++;

	const q = css.charCodeAt(j);
	if (q === 34 /* " */ || q === 39 /* ' */) {
		const start = j + 1;
		let k = start;
		// The scan already visits every character, so it records whether the
		// token carries an escape rather than making `decodeCssEscapes` scan
		// for one all over again.
		let escaped = false;
		while (k < n) {
			const c = css.charCodeAt(k);
			if (c === 92 /* \\ */) {
				escaped = true;
				k += 2;
				continue;
			}
			if (c === q) break;
			if (isNewline(c)) return null;
			k++;
		}
		if (k >= n) return null;

		const raw = css.slice(start, k);
		const url = escaped ? decodeCssEscapes(raw) : raw;
		let m = k + 1;
		while (m < n && isWhitespace(css.charCodeAt(m))) m++;
		if (css.charCodeAt(m) !== 41 /* ) */ || url.trim() === "") return null;

		const quote = String.fromCharCode(q);

		return { open: quote, url, close: quote, end: m + 1 };
	}

	let k = j;
	let escaped = false;
	while (k < n) {
		const c = css.charCodeAt(k);
		if (c === 92 /* \\ */) {
			escaped = true;
			k += 2;
			continue;
		}
		if (c === 41 /* ) */) break;
		k++;
	}
	if (k >= n) return null;

	const raw = css.slice(j, k);
	const url = escaped ? decodeCssEscapes(raw) : raw;
	if (url.trim() === "") return null;

	return { open: "", url, close: "", end: k + 1 };
}

type ImportToken = {
	url: string;
	/** The quote the value is written inside, or `""` when it is unquoted. */
	quote: string;
	start: number;
	end: number;
	next: number;
};

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
		const url = decodeCssEscapesIfNeeded(css.slice(start, end));
		if (url.trim() === "") return null;

		return { url, quote: String.fromCharCode(q), start, end, next };
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

	return {
		url: decodeCssEscapesIfNeeded(css.slice(start, j)),
		quote: "",
		start,
		end: j,
		next: j,
	};
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
				out +=
					css.slice(last, token.start) +
					escapeCssUrl(replace(token.url), token.quote);
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
					escapeCssUrl(replace(token.url), token.open) +
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
