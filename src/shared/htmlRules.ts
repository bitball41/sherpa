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

// Attribute rewriting runs for every element parsed from a page and for every
// dynamic setAttribute call. Index the small rule table once instead of
// repeatedly scanning every rule and every selector on those hot paths.
const htmlRulesByAttribute = new Map<string, HtmlRule[]>();

for (const rule of htmlRules) {
	for (const attribute in rule) {
		if (attribute === "fn") continue;

		const rules = htmlRulesByAttribute.get(attribute);
		if (rules) rules.push(rule);
		else htmlRulesByAttribute.set(attribute, [rule]);
	}
}

// Keep the standalone list the selector rewriter reads in step with the rules
// above, so a rule added here can never quietly stop being visible to
// selectors. (The list can't simply be derived from this module: it has to be
// importable without dragging in the WASM JS rewriter.)
for (const attribute of htmlRulesByAttribute.keys()) {
	shadowedAttributeNames.add(attribute);
}

export function findHtmlRule(
	attribute: string,
	elementName: string
): HtmlRule | undefined {
	const normalizedAttribute = attribute.toLowerCase();
	const rules = htmlRulesByAttribute.get(normalizedAttribute);
	if (!rules) return;

	for (const rule of rules) {
		const selector = rule[normalizedAttribute];
		if (selector === "*") return rule;
		if (Array.isArray(selector) && selector.includes(elementName)) return rule;
	}
}
