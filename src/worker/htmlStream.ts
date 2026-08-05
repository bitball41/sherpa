/**
 * Document responses, and why they are not simply buffered.
 *
 * Every proxied document loads three parser-blocking boot scripts - the WASM
 * rewriter payload, the runtime bundle, and a small inline script - before any
 * of the page's own content runs. Those scripts live on the proxy's origin and
 * cost roughly 45-60 ms of main-thread work per document once fetched.
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
import type { CookieStore } from "@/shared/cookie";
import {
	renderInjectScripts,
	rewriteHtml,
	rewriteHtmlAfterPrelude,
} from "@rewriters/html";
import type { URLMeta } from "@rewriters/url";

/**
 * Bytes to wait for before flushing. The HTML spec's encoding sniff looks at
 * the first 1024 bytes, and a doctype that has not appeared by then is not
 * going to; this is also comfortably inside the first network chunk.
 */
const PREFLUSH_BYTES = 1024;

const encoder = new TextEncoder();

// Per the HTML spec's encoding-sniffing algorithm: an explicit HTTP charset
// wins, then a BOM, then a <meta charset> declaration sniffed from the first
// 1024 bytes (decoded as windows-1252, which never throws since every byte
// maps to some character - this matches how browsers prescan).
const headerCharsetRegex = /charset=["']?([\w-]+)/i;
const metaCharsetRegex = /<meta[^>]+charset=["']?([\w-]+)/i;
const prescanDecoder = new TextDecoder("windows-1252");
const utf8Decoder = new TextDecoder("utf-8");
const decodersByCharset = new Map<string, TextDecoder>();

export function detectHtmlCharset(
	bytes: Uint8Array,
	contentTypeHeader: string | null
): string {
	const headerCharset = contentTypeHeader?.match(headerCharsetRegex)?.[1];
	if (headerCharset) return headerCharset.toLowerCase();

	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
		return "utf-8";
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

	const prefix = prescanDecoder.decode(
		bytes.subarray(0, Math.min(1024, bytes.length))
	);
	const metaCharset = prefix.match(metaCharsetRegex)?.[1];
	if (metaCharset) return metaCharset.toLowerCase();

	return "utf-8";
}

export function decodeWithCharset(bytes: Uint8Array, charset: string): string {
	let decoder = decodersByCharset.get(charset);
	if (!decoder) {
		try {
			decoder = new TextDecoder(charset);
		} catch {
			// unrecognized/unsupported charset label - fall back rather than
			// throwing and breaking the page entirely
			decoder = utf8Decoder;
		}
		// charset labels seen by one worker form a tiny set, but cap it anyway
		if (decodersByCharset.size < 64) decodersByCharset.set(charset, decoder);
	}

	return decoder.decode(bytes);
}

function concatChunks(chunks: Uint8Array[], size: number): Uint8Array {
	if (chunks.length === 1) return chunks[0];
	const joined = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.length;
	}

	return joined;
}

function isAsciiWhitespace(byte: number): boolean {
	return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/**
 * The document's leading doctype, exactly as the origin wrote it, or `""` when
 * the document has none (which is itself meaningful - it is what puts the page
 * in quirks mode, and the flushed prelude has to reproduce it either way).
 *
 * Returns `null` when the answer isn't in the bytes seen so far, in which case
 * the caller falls back to buffering rather than guessing.
 */
function leadingDoctype(bytes: Uint8Array): string | null {
	let i = 0;
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;

	for (;;) {
		while (i < bytes.length && isAsciiWhitespace(bytes[i])) i++;
		if (i >= bytes.length) return null;
		if (bytes[i] !== 0x3c /* < */) return "";

		// a comment may precede the doctype; skip it and look again
		if (
			bytes[i + 1] === 0x21 &&
			bytes[i + 2] === 0x2d &&
			bytes[i + 3] === 0x2d
		) {
			let end = i + 4;
			while (end + 2 < bytes.length) {
				if (
					bytes[end] === 0x2d &&
					bytes[end + 1] === 0x2d &&
					bytes[end + 2] === 0x3e
				)
					break;
				end++;
			}
			if (end + 2 >= bytes.length) return null;
			i = end + 3;
			continue;
		}

		if (bytes[i + 1] !== 0x21 /* ! */) return "";
		const keyword = "doctype";
		for (let k = 0; k < keyword.length; k++) {
			const byte = bytes[i + 2 + k];
			if (byte === undefined) return null;
			if ((byte | 0x20) !== keyword.charCodeAt(k)) return "";
		}

		let end = i + 2 + keyword.length;
		while (end < bytes.length && bytes[end] !== 0x3e /* > */) end++;
		if (end >= bytes.length) return null;

		// doctypes are ASCII by definition, so latin1 is byte-exact here
		return prescanDecoder.decode(bytes.subarray(i, end + 1));
	}
}

/** UTF-16 byte offsets aren't character offsets, so the prelude can't be split out. */
function canSplitPrelude(charset: string): boolean {
	return !charset.startsWith("utf-16") && charset !== "unicodefeff";
}

async function drain(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	chunks: Uint8Array[],
	size: number
): Promise<Uint8Array> {
	for (;;) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();
		if (done) break;
		if (value?.length) {
			chunks.push(value);
			size += value.length;
		}
	}

	return concatChunks(chunks, size);
}

/**
 * Rewrites an HTML document response, flushing the doctype and boot scripts as
 * soon as the shape of the document is known.
 *
 * Falls back to the fully-buffered string when early flushing would gain
 * nothing (the whole document already arrived) or cannot be done safely (a
 * UTF-16 document, or one whose leading doctype is still unresolved after
 * `PREFLUSH_BYTES`).
 */
export async function rewriteHtmlResponse(
	body: ReadableStream<Uint8Array> | null,
	contentTypeHeader: string | null,
	cookieStore: CookieStore,
	meta: URLMeta
): Promise<string | ReadableStream<Uint8Array>> {
	if (!body) return "";

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let complete = false;

	while (size < PREFLUSH_BYTES) {
		// sequential by nature: each read depends on the previous one finishing
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();
		if (done) {
			complete = true;
			break;
		}
		if (value?.length) {
			chunks.push(value);
			size += value.length;
		}
	}

	const head = concatChunks(chunks, size);
	const charset = detectHtmlCharset(head, contentTypeHeader);
	const doctype =
		complete || !canSplitPrelude(charset) ? null : leadingDoctype(head);

	if (doctype === null) {
		const full = complete ? head : await drain(reader, chunks, size);

		return rewriteHtml(
			decodeWithCharset(full, charset),
			cookieStore,
			meta,
			true
		);
	}

	const prelude = encoder.encode(doctype + renderInjectScripts(cookieStore));

	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(prelude);

			// Not awaited: the point of the whole exercise is that this runs
			// while the renderer is already fetching the boot scripts.
			void (async () => {
				try {
					const full = await drain(reader, chunks, size);
					controller.enqueue(
						encoder.encode(
							rewriteHtmlAfterPrelude(
								decodeWithCharset(full, charset),
								cookieStore,
								meta
							)
						)
					);
					controller.close();
				} catch (error) {
					// The upstream headers were already delivered, so the error
					// page is no longer an option; fail the body instead, the
					// same way a truncated upstream response would.
					console.error("failed to rewrite a proxied document", error);
					controller.error(error);
				}
			})();
		},
		cancel(reason) {
			void reader.cancel(reason);
		},
	});
}
