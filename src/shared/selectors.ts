import {
	SHADOW_ATTRIBUTE_PREFIX,
	shadowedAttributeNames,
} from "@/shared/shadowAttributes";

/**
 * Rewrites attribute selectors so they test the value the page actually
 * wrote rather than the value Sherpa replaced it with.
 *
 * A proxied `<a>`'s `href` attribute holds `https://proxy/prefix/<encoded>`,
 * so every selector a site writes against its own URLs - `a[href^="/help/"]`,
 * `img[src$=".svg"]`, `[href="https://example.com/"]` - matches nothing at
 * all. Sherpa already keeps the authored value in a `sherpa-attr-*` shadow
 * attribute for the attribute *APIs*; selectors just never consulted it.
 *
 * Each rewritable attribute selector becomes
 * `:is([sherpa-attr-name<op>], [name<op>])`, so an element that carries the
 * shadow attribute is matched on its original value while one that never went
 * through a Sherpa trap (markup built by `DOMParser`, say) still matches on
 * its own. `:is()` keeps the result a single compound selector, so it can be
 * substituted in place anywhere in a selector list.
 */
export function rewriteSelectorText(selector: string): string {
	// The overwhelming majority of selectors a page runs (`.cls`, `#id`,
	// `div > span`) carry no attribute selector at all, and this sits in front
	// of `querySelector`/`matches`/`closest`.
	if (selector.indexOf("[") === -1) return selector;

	let out = "";
	let last = 0;
	let i = 0;
	const n = selector.length;

	while (i < n) {
		const c = selector.charCodeAt(i);

		// Strings can hold anything, including a `[`; skip them wholesale.
		if (c === 34 /* " */ || c === 39 /* ' */) {
			i = skipString(selector, i, c);
			continue;
		}
		if (c === 92 /* \ */) {
			i += 2;
			continue;
		}
		if (c !== 91 /* [ */) {
			i++;
			continue;
		}

		const parsed = parseAttributeSelector(selector, i);
		if (!parsed) {
			i++;
			continue;
		}

		if (shadowedAttributeNames.has(parsed.name)) {
			// From the name onward, so leading whitespace inside the brackets
			// can't end up between the prefix and the attribute name.
			const body = selector.slice(parsed.nameStart, parsed.end - 1);
			out +=
				selector.slice(last, i) +
				`:is([${SHADOW_ATTRIBUTE_PREFIX}${body}],[${body}])`;
			last = parsed.end;
		}

		i = parsed.end;
	}

	if (last === 0) return selector;

	return out + selector.slice(last);
}

/** `i` points at the opening quote; returns the index just past the close. */
function skipString(text: string, i: number, quote: number): number {
	const n = text.length;
	i++;
	while (i < n) {
		const c = text.charCodeAt(i);
		if (c === 92 /* \ */) {
			i += 2;
			continue;
		}
		if (c === quote) return i + 1;
		i++;
	}

	return n;
}

function isNameChar(c: number): boolean {
	return (
		(c >= 97 && c <= 122) || // a-z
		(c >= 65 && c <= 90) || // A-Z
		(c >= 48 && c <= 57) || // 0-9
		c === 45 || // -
		c === 95 || // _
		c >= 128 // non-ASCII idents
	);
}

type AttributeSelector = { name: string; nameStart: number; end: number };

/**
 * Parses `[name]`, `[name=value]`, `[name^="value" i]` and friends starting at
 * the `[` in `open`. Returns the *lowercased, unescaped* attribute name and
 * the index just past the closing `]`, or null if this isn't an attribute
 * selector Sherpa should touch (a namespaced one, or malformed input the
 * browser is better placed to reject).
 */
function parseAttributeSelector(
	selector: string,
	open: number
): AttributeSelector | null {
	const n = selector.length;
	let i = open + 1;

	while (i < n && isSpace(selector.charCodeAt(i))) i++;

	// `[ns|attr]` and `[*|attr]` carry a namespace; the shadow attribute has
	// none, so leave those to the browser untouched.
	const nameStart = i;
	let name = "";
	while (i < n) {
		const c = selector.charCodeAt(i);
		if (c === 92 /* \ */) {
			// A CSS escape stands for the literal next character, which is how
			// `xlink:href` has to be written (`xlink\:href`).
			if (i + 1 >= n) return null;
			name += selector[i + 1];
			i += 2;
			continue;
		}
		if (!isNameChar(c)) break;
		name += selector[i];
		i++;
	}

	if (!name) return null;
	if (selector.charCodeAt(i) === 124 /* | */) return null;

	while (i < n && isSpace(selector.charCodeAt(i))) i++;
	if (i >= n) return null;

	const c = selector.charCodeAt(i);
	if (c === 93 /* ] */) {
		return { name: name.toLowerCase(), nameStart, end: i + 1 };
	}

	// operator: `=` or one of `~= |= ^= $= *=`
	if (c === 126 || c === 124 || c === 94 || c === 36 || c === 42) {
		if (selector.charCodeAt(i + 1) !== 61 /* = */) return null;
		i += 2;
	} else if (c === 61 /* = */) {
		i += 1;
	} else {
		return null;
	}

	while (i < n && isSpace(selector.charCodeAt(i))) i++;

	const quote = selector.charCodeAt(i);
	if (quote === 34 /* " */ || quote === 39 /* ' */) {
		i = skipString(selector, i, quote);
	} else {
		while (i < n) {
			const v = selector.charCodeAt(i);
			if (v === 92 /* \ */) {
				i += 2;
				continue;
			}
			if (v === 93 /* ] */ || isSpace(v)) break;
			i++;
		}
	}

	// optional `i`/`s` case-sensitivity flag
	while (i < n && isSpace(selector.charCodeAt(i))) i++;
	if (i < n && selector.charCodeAt(i) !== 93 /* ] */) {
		const flag = selector.charCodeAt(i) | 0x20;
		if (flag !== 105 /* i */ && flag !== 115 /* s */) return null;
		i++;
		while (i < n && isSpace(selector.charCodeAt(i))) i++;
	}

	if (selector.charCodeAt(i) !== 93 /* ] */) return null;

	return { name: name.toLowerCase(), nameStart, end: i + 1 };
}

function isSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}
