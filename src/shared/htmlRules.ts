import { CookieStore } from "@/shared/cookie";
import { rewriteCss } from "@rewriters/css";
import { rewriteHtml, rewriteSrcset } from "@rewriters/html";
import { rewriteUrl, unrewriteBlob, URLMeta } from "@rewriters/url";
import { shadowedAttributeNames } from "@/shared/shadowAttributes";

export type HtmlRule = {
	[key: string]: "*" | string[] | ((...any: any[]) => string | null);
	fn: (value: string, meta: URLMeta, cookieStore: CookieStore) => string | null;
};

/**
 * SVG elements whose `href` / `xlink:href` is a resource reference the browser
 * resolves and fetches. `<use>` is the one that matters most in practice (icon
 * sprites), but a gradient's or filter's `href` is fetched the same way.
 */
const SVG_URL_ELEMENTS = [
	"use",
	"image",
	"feimage",
	"filter",
	"pattern",
	"lineargradient",
	"radialgradient",
	"textpath",
	"mpath",
	"animate",
	"animatemotion",
	"animatetransform",
	"set",
	"cursor",
	"tref",
];

export const htmlRules: HtmlRule[] = [
	{
		fn: (value: string, meta: URLMeta) => {
			return rewriteUrl(value, meta);
		},

		// url rewrites
		src: ["embed", "script", "img", "frame", "source", "input", "track"],
		href: [
			"a",
			"link",
			"area",
			// SVG resource references. SVG 2 spells them `href`, SVG 1.1 spells
			// them `xlink:href`, and real-world markup is full of both - an icon
			// sprite is almost always `<use xlink:href="sprite.svg#id">`, which
			// was left alone and so resolved against the *proxy's* origin.
			...SVG_URL_ELEMENTS,
		],
		"xlink:href": SVG_URL_ELEMENTS,
		data: ["object"],
		action: ["form"],
		formaction: ["button", "input", "textarea", "submit"],
		poster: ["video"],
		// Obsolete but still honored by every engine, and still present on
		// older pages: `<body background=...>` and its table equivalents load
		// an image exactly like `<img src>` does.
		background: ["body", "table", "thead", "tbody", "tfoot", "tr", "td", "th"],
	},
	{
		fn: (value: string, meta: URLMeta) => {
			const url = rewriteUrl(value, meta);
			// if (meta.topFrameName)
			// 	url += `?topFrame=${meta.topFrameName}&parentFrame=${meta.parentFrameName}`;

			return url;
		},
		src: ["iframe"],
	},
	{
		// is this a good idea?
		fn: (_value: string, _meta: URLMeta) => {
			return null;
		},
		sandbox: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => {
			if (value.startsWith("blob:")) {
				// for media elements specifically they must take the original blob
				// because they can't be fetch'd
				return unrewriteBlob(value);
			}

			return rewriteUrl(value, meta);
		},
		src: ["video", "audio"],
	},
	{
		fn: () => "",

		integrity: ["script", "link"],
	},
	{
		fn: () => null,

		// csp stuff that must be deleted
		nonce: "*",
		csp: ["iframe"],
		credentialless: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => rewriteSrcset(value, meta),

		// srcset
		srcset: ["img", "source"],
		imagesrcset: ["link"],
	},
	{
		// about:srcdoc inherits the embedding document's fallback base URL.
		// rewriteHtml resolves the meta into its own object before traversing,
		// so a <base> inside the srcdoc can't reach the parent document's base.
		fn: (value: string, meta: URLMeta, cookieStore: CookieStore) =>
			rewriteHtml(value, cookieStore, meta, true),

		// srcdoc
		srcdoc: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => rewriteCss(value, meta),
		style: "*",
	},
	{
		// `_top`/`_parent` are emulated by retargeting at the real frame's name,
		// because the proxied document's frame tree is not the browsing context
		// the page thinks it is. The frame names are only known in a page realm:
		// in the service worker, where static HTML is rewritten, `URLMeta`
		// carries no frame names at all. Falling through to `undefined` there
		// serialized as `target=""`, which is `_self` - so a `<a target="_top">`
		// in server-rewritten markup silently navigated the frame it was in
		// instead of the top one. Keeping the original keyword lets the browser
		// (and the client's own `target` trap, which does know the names) handle
		// it.
		fn: (value: string, meta: URLMeta) => {
			if (value === "_top" || value === "_unfencedTop")
				return meta.topFrameName ?? value;
			else if (value === "_parent") return meta.parentFrameName ?? value;
			else return value;
		},
		target: ["a", "base"],
	},
];

// Attribute rewriting runs for every attribute of every element in every
// document, and for every dynamic `setAttribute` a page makes. The rule table
// is indexed once here rather than scanned per lookup - and each rule's
// element list becomes a Set, so widening one (the SVG `href`/`xlink:href`
// list is fifteen elements) costs nothing at the lookup.
type IndexedRule = { rule: HtmlRule; elements: Set<string> | null };

const htmlRulesByAttribute = new Map<string, IndexedRule[]>();

for (const rule of htmlRules) {
	for (const attribute in rule) {
		if (attribute === "fn") continue;

		const selector = rule[attribute];
		const indexed: IndexedRule = {
			rule,
			// `null` stands for the `"*"` selector: matches every element.
			elements: Array.isArray(selector) ? new Set(selector) : null,
		};

		const rules = htmlRulesByAttribute.get(attribute);
		if (rules) rules.push(indexed);
		else htmlRulesByAttribute.set(attribute, [indexed]);
	}
}

// Keep the standalone list the selector rewriter reads in step with the rules
// above, so a rule added here can never quietly stop being visible to
// selectors. (The list can't simply be derived from this module: it has to be
// importable without dragging in the WASM JS rewriter.)
for (const attribute of htmlRulesByAttribute.keys()) {
	shadowedAttributeNames.add(attribute);
}

/**
 * ASCII-lowercases only when it has to. Attribute names arrive already
 * lowercased from the HTML parser, and from `setAttribute` on an HTML element,
 * so the usual answer is "no change" - and `toLowerCase()` allocates a copy
 * either way, while this scan does not.
 */
function lowerAttributeName(attribute: string): string {
	for (let i = 0; i < attribute.length; i++) {
		const code = attribute.charCodeAt(i);
		if (code >= 65 && code <= 90) return attribute.toLowerCase();
	}

	return attribute;
}

export function findHtmlRule(
	attribute: string,
	elementName: string
): HtmlRule | undefined {
	const rules = htmlRulesByAttribute.get(lowerAttributeName(attribute));
	if (!rules) return;

	for (let i = 0; i < rules.length; i++) {
		const { rule, elements } = rules[i];
		if (elements === null || elements.has(elementName)) return rule;
	}
}
