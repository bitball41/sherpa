import { URLMeta } from "./url";
import { CookieStore } from "../cookie";
import { bytesToBase64 } from "../base64";
/**
 * Prefix of the shadow attributes that keep a page's *original* attribute
 * values readable after Sherpa rewrites them.
 */
export declare const SHADOW_ATTRIBUTE_PREFIX = "sherpa-attr-";
/** Shadow attribute holding the base64 source of a rewritten inline script. */
export declare const SCRIPT_SOURCE_ATTRIBUTE = "sherpa-attr-script-source-src";
export declare function getInjectScripts<T>(cookieStore: CookieStore, script: (src: string) => T): T[];
export declare function rewriteHtml(html: string, cookieStore: CookieStore, meta: URLMeta, fromTop?: boolean): string;
export declare function unrewriteHtml(html: string): string;
export declare function rewriteSrcset(srcset: string, meta: URLMeta): string;
export { bytesToBase64 };
export declare function isEventAttribute(name: string): boolean;
