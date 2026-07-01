import { CookieStore } from "@/shared/cookie";
import { rewriteCss } from "@rewriters/css";
import { rewriteHtml, rewriteSrcset } from "@rewriters/html";
import { rewriteUrl, unrewriteBlob, URLMeta } from "@rewriters/url";

export type HtmlRule = {
	[key: string]: "*" | string[] | ((...any: any[]) => string | null);
	fn: (value: string, meta: URLMeta, cookieStore: CookieStore) => string | null;
};

export const htmlRules: HtmlRule[] = [
	{
		fn: (value: string, meta: URLMeta) => {
			return rewriteUrl(value, meta);
		},

		// url rewrites
		src: ["embed", "script", "img", "frame", "source", "input", "track"],
		href: ["a", "link", "area", "use", "image"],
		data: ["object"],
		action: ["form"],
		formaction: ["button", "input", "textarea", "submit"],
		poster: ["video"],
		"xlink:href": ["image"],
	},
	{
		fn: (value: string, meta: URLMeta) => {
			let url = rewriteUrl(value, meta);
			// if (meta.topFrameName)
			// 	url += `?topFrame=${meta.topFrameName}&parentFrame=${meta.parentFrameName}`;

			return url;
		},
		src: ["iframe"],
	},
	{
		// is this a good idea?
		fn: (value: string, meta: URLMeta) => {
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
		fn: (value: string, meta: URLMeta, cookieStore: CookieStore) =>
			rewriteHtml(
				value,
				cookieStore,
				{
					// for srcdoc origin is the origin of the page that the iframe is on. base and path get dropped
					origin: new URL(meta.origin.origin),
					base: new URL(meta.origin.origin),
				},
				true
			),

		// srcdoc
		srcdoc: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => rewriteCss(value, meta),
		style: "*",
	},
	{
		fn: (value: string, meta: URLMeta) => {
			if (value === "_top" || value === "_unfencedTop")
				return meta.topFrameName;
			else if (value === "_parent") return meta.parentFrameName;
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
