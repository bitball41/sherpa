/**
 * Document responses, and why they are not simply buffered.
 *
 * Every proxied document loads three parser-blocking boot scripts - a tiny
 * WASM prefetch, the runtime bundle, and a no-store `$boot` script that
 * seeds the cookie jar and calls `loadAndHook` - before any of the page's
 * own content runs. The rewriter binary itself is fetched as `application/wasm`
 * in parallel with the runtime, instead of being parsed as a 695 KiB classic
 * script per document.
 *
 * On the buffered design the browser could not even *ask* for them until the
 * entire upstream document had crossed the transport and been rewritten,
 * because a service worker's response does not exist until its body does.
 * Time-to-first-byte was therefore the document's whole download time - on a
 * 1.2 MiB document over a 10 Mbit/s link, 1.2 seconds of blank page before the
 * renderer saw a single byte, and only then did the runtime start loading.
 *
 * So the response is a stream whose first chunk - the document's own doctype
 * plus those three script tags - is written as soon as the first ~1 KiB of the
 * upstream body has arrived. The runtime downloads, parses and compiles while
 * the rest of the document is still on the wire.
 *
 * What this deliberately does *not* do is rewrite incrementally: the remainder
 * is still buffered and parsed as one tree, so `<base href>` resolution and
 * every rewriting rule behave exactly as before. Only the flush point moves.
 */
import type { CookieStore } from "../shared/cookie";
import type { URLMeta } from "../shared/rewriters/url";
export declare function detectHtmlCharset(bytes: Uint8Array, contentTypeHeader: string | null): string;
export declare function decodeWithCharset(bytes: Uint8Array, charset: string): string;
export type HtmlResponseRewrite = {
    rewrote: boolean;
    body: string | ReadableStream<Uint8Array> | Uint8Array;
};
/**
 * Rewrites an HTML document response, flushing the doctype and boot scripts as
 * soon as the shape of the document is known.
 *
 * Falls back to the fully-buffered string when early flushing would gain
 * nothing (the whole document already arrived) or cannot be done safely (a
 * UTF-16 document, or one whose leading doctype is still unresolved after
 * `PREFLUSH_BYTES`).
 *
 * When `sniff` is set, the first chunk is MIME-sniffed: bytes that do not look
 * like HTML (a PDF served as `application/octet-stream`, say) are passed
 * through unrewritten so a mislabelled binary download is not turned into a
 * document.
 */
export declare function rewriteHtmlResponse(body: ReadableStream<Uint8Array> | null, contentTypeHeader: string | null, cookieStore: CookieStore, meta: URLMeta, sniff?: boolean): Promise<HtmlResponseRewrite>;
