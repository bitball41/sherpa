import {
	URLMeta,
	rewriteUrl,
	snapshotMeta,
	unrewriteUrl,
} from "@rewriters/url";
import { rewriteCssReferences } from "./cssUrls";

/**
 * True when a `<style>` element's `type` means the browser will actually apply
 * its contents as CSS.
 *
 * Per HTML a style element is only a stylesheet when `type` is absent, empty,
 * or `text/css`; anything else makes the element inert markup that some library
 * reads for itself. Sherpa rewrote those bodies anyway, which broke exactly the
 * tools that use the idiom: Tailwind's browser build keeps its input in
 * `<style type="text/tailwindcss">`, and rewriting turned its
 * `@import "tailwindcss"` into a proxied absolute URL that Tailwind then failed
 * to resolve. Content the browser will never parse as CSS has no URLs for
 * Sherpa to fix, so the correct thing is to leave it exactly as authored.
 */
export function isCssStyleType(type: string | null | undefined): boolean {
	if (type == null) return true;
	const essence = type.split(";")[0].trim().toLowerCase();

	return essence === "" || essence === "text/css";
}

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
