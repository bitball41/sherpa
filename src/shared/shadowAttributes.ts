/**
 * Sherpa rewrites a page's URL-bearing attributes in place and keeps the value
 * the page actually authored in a parallel `sherpa-attr-*` attribute, so the
 * attribute APIs (and now selectors) can hand the original back.
 *
 * This module is deliberately dependency-free: the selector rewriter needs to
 * know which attribute names are shadowed, and `htmlRules` - the table those
 * names come from - transitively pulls in the WASM JS rewriter.
 */

/**
 * Prefix of the shadow attributes that keep a page's *original* attribute
 * values readable after Sherpa rewrites them.
 */
export const SHADOW_ATTRIBUTE_PREFIX = "sherpa-attr-";

/** Shadow attribute holding the base64 source of a rewritten inline script. */
export const SCRIPT_SOURCE_ATTRIBUTE = `${SHADOW_ATTRIBUTE_PREFIX}script-source-src`;

/**
 * Every attribute name a rule in `htmlRules` can rewrite, and therefore every
 * attribute whose authored value lives in a shadow attribute.
 *
 * `htmlRules` adds its own keys to this set when it loads, so a rule added
 * there without a matching entry here still behaves correctly at runtime; the
 * literals below are what keeps the set usable (and testable) on its own.
 */
export const shadowedAttributeNames = new Set([
	"src",
	"href",
	"data",
	"action",
	"formaction",
	"poster",
	"xlink:href",
	"sandbox",
	"integrity",
	"nonce",
	"csp",
	"credentialless",
	"srcset",
	"imagesrcset",
	"srcdoc",
	"style",
	"target",
]);
