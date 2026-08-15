import { URLMeta } from "./url";
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
export declare function isCssStyleType(type: string | null | undefined): boolean;
export declare function rewriteCss(css: string, meta: URLMeta): string;
export declare function unrewriteCss(css: string): string;
