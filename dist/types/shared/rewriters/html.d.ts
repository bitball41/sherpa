import { URLMeta } from "./url";
import { CookieStore } from "../cookie";
import { bytesToBase64 } from "../base64";
import { SCRIPT_SOURCE_ATTRIBUTE, SHADOW_ATTRIBUTE_PREFIX } from "../shadowAttributes";
export { SCRIPT_SOURCE_ATTRIBUTE, SHADOW_ATTRIBUTE_PREFIX };
export declare function getInjectScripts<T>(documentUrl: URL, script: (src: string) => T): T[];
export declare function rewriteHtml(html: string, cookieStore: CookieStore, meta: URLMeta, fromTop?: boolean): string;
/**
 * The boot scripts as literal markup, for the early-flush document path in
 * `worker/htmlStream.ts`: they are written out before the document has finished
 * downloading, so there is no parsed tree to unshift them into yet.
 */
export declare function renderInjectScripts(documentUrl: URL): string;
/**
 * Rewrites a document whose doctype and boot scripts have already been written
 * out, so it emits neither: the scripts are not injected, and a leading doctype
 * is dropped rather than repeated.
 *
 * Parsing is unchanged - the whole document is still parsed and traversed as
 * one tree, so `<base href>` resolution and every rewriting rule behave exactly
 * as they do on the buffered path. Only the point at which the renderer gets
 * its first bytes moves.
 */
export declare function rewriteHtmlAfterPrelude(html: string, cookieStore: CookieStore, meta: URLMeta): string;
export declare function unrewriteHtml(html: string): string;
/** Undo runtime markup in XMLSerializer output without applying HTML rules. */
export declare function unrewriteXml(xml: string): string;
export declare function rewriteSrcset(srcset: string, meta: URLMeta): string;
export { bytesToBase64 };
export declare function isEventAttribute(name: string): boolean;
