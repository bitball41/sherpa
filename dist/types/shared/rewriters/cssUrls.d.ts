/** Rewrite only real CSS `url()` tokens. */
export declare function rewriteCssUrls(css: string, replace: (url: string) => string): string;
/** Rewrite `url()` tokens and top-level bare-string `@import` references. */
export declare function rewriteCssReferences(css: string, replace: (url: string) => string): string;
