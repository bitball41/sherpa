/**
 * Sherpa rewrites a page's URL-bearing attributes in place and keeps the value
 * the page actually authored in a parallel shadow attribute, so the
 * attribute APIs (and now selectors) can hand the original back.
 *
 * The prefix itself lives in `pageSurface.ts` so every page-facing identifier
 * is defined in one place. This module still has no WASM/htmlRules imports:
 * the selector rewriter needs to know which attribute names are shadowed, and
 * `htmlRules` transitively pulls in the WASM JS rewriter.
 */
import { SHADOW_ATTRIBUTE_PREFIX } from "./pageSurface";

export { SHADOW_ATTRIBUTE_PREFIX };

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
	"ping",
	"background",
]);
