export declare function isRedirectStatus(status: number): boolean;
export declare function contentTypeEssence(contentType: string | null): string;
export declare function isHtmlContentType(contentType: string | null): boolean;
/**
 * Content types that are not HTML but that browsers still sniff as HTML on a
 * document navigation when the server omitted a real type. `text/plain` is
 * deliberately not in this set: navigating to a `.txt` must not grow boot
 * scripts.
 */
export declare function isSniffableHtmlContentType(contentType: string | null): boolean;
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
export declare function sniffHtml(bytes: Uint8Array, complete: boolean): HtmlSniff;
export declare function looksLikeHtml(bytes: Uint8Array): boolean;
export declare function normalizeHtmlContentType(contentType?: string): string;
