import { URLMeta } from "./url";
import { CookieStore } from "../cookie";
import { bytesToBase64 } from "../base64";
export declare function getInjectScripts<T>(cookieStore: CookieStore, script: (src: string) => T): T[];
export declare function rewriteHtml(html: string, cookieStore: CookieStore, meta: URLMeta, fromTop?: boolean): string;
export declare function unrewriteHtml(html: string): string;
export declare function rewriteSrcset(srcset: string, meta: URLMeta): string;
export { bytesToBase64 };
export declare function isEventAttribute(name: string): boolean;
