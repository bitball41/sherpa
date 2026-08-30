const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isRedirectStatus(status: number): boolean {
	return REDIRECT_STATUSES.has(status);
}

export function contentTypeEssence(contentType: string | null): string {
	return contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

export function isHtmlContentType(contentType: string | null): boolean {
	return contentTypeEssence(contentType) === "text/html";
}

/**
 * Content types that are not HTML but that browsers still sniff as HTML on a
 * document navigation when the server omitted a real type. `text/plain` is
 * deliberately not in this set: navigating to a `.txt` must not grow boot
 * scripts.
 */
export function isSniffableHtmlContentType(
	contentType: string | null
): boolean {
	const essence = contentTypeEssence(contentType);

	return (
		essence === "" ||
		essence === "application/octet-stream" ||
		essence === "application/unknown" ||
		essence === "unknown/unknown"
	);
}

export type HtmlSniff = "html" | "binary" | "need-more";

/**
 * MIME-sniffing "looks like HTML": after a BOM and leading whitespace, a `<`
 * followed by `!`, `?`, `/`, or an ASCII letter. Used so a document served as
 * `application/octet-stream` (or with no Content-Type at all) is still
 * rewritten instead of leaking unproxied URLs, while a PDF/PNG under the same
 * type is passed through.
 *
 * `need-more` means the bytes seen so far are only a prefix (BOM, whitespace,
 * or a truncated `<`) and the caller should read further before deciding.
 * `looksLikeHtml` treats an incomplete buffer as not-HTML, which is the right
 * answer only once the body is known to have ended.
 */
export function sniffHtml(bytes: Uint8Array, complete: boolean): HtmlSniff {
	let i = 0;
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
	while (i < bytes.length) {
		const b = bytes[i];
		if (b === 0x20 || (b >= 0x09 && b <= 0x0d)) {
			i++;
			continue;
		}
		break;
	}
	if (i >= bytes.length) return complete ? "binary" : "need-more";
	if (bytes[i] !== 0x3c /* < */) return "binary";
	const next = bytes[i + 1];
	if (next === undefined) return complete ? "binary" : "need-more";
	if (next === 0x21 || next === 0x3f || next === 0x2f) return "html";
	if ((next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a))
		return "html";

	return "binary";
}

export function looksLikeHtml(bytes: Uint8Array): boolean {
	return sniffHtml(bytes, true) === "html";
}

export function normalizeHtmlContentType(contentType?: string): string {
	const value = contentType?.trim() || "text/html";
	// Once a sniffable response has been positively identified and rewritten as
	// HTML, expose it as HTML. Keeping application/octet-stream here makes modern
	// browsers download the rewritten document instead of rendering it.
	if (!isHtmlContentType(value)) return "text/html; charset=utf-8";
	const charset = /;\s*charset\s*=\s*(?:"[^"]*"|'[^']*'|[^;\s]*)/i;
	if (charset.test(value)) return value.replace(charset, "; charset=utf-8");

	return `${value}; charset=utf-8`;
}
