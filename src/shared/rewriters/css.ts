import {
	URLMeta,
	rewriteUrl,
	snapshotMeta,
	unrewriteUrl,
} from "@rewriters/url";
import { rewriteCssReferences } from "./cssUrls";

export function rewriteCss(css: string, meta: URLMeta) {
	// A stylesheet's document base can't change while it is being scanned, so
	// resolve the (potentially DOM-querying) meta accessors once for the whole
	// sheet instead of once per url()/@import reference.
	const resolved = snapshotMeta(meta);

	return rewriteCssReferences(css, (url) => rewriteUrl(url.trim(), resolved));
}

export function unrewriteCss(css: string) {
	return rewriteCssReferences(css, (url) => unrewriteUrl(url.trim()));
}
