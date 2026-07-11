import { URLMeta, rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { rewriteCssReferences } from "./cssUrls";

export function rewriteCss(css: string, meta: URLMeta) {
	return handleCss("rewrite", css, meta);
}

export function unrewriteCss(css: string) {
	return handleCss("unrewrite", css);
}

function handleCss(type: "rewrite" | "unrewrite", css: string, meta?: URLMeta) {
	return rewriteCssReferences(css, (url) =>
		type === "rewrite"
			? rewriteUrl(url.trim(), meta!)
			: unrewriteUrl(url.trim())
	);
}
