export declare function isUrlLikeSpecifier(specifier: string): boolean;
/**
 * Rewrites every URL-bearing part of an import map in place.
 *
 * `imports` and each scoped specifier map store URLs in their values. `scopes`
 * and `integrity` store URLs in their keys, so those objects are rebuilt with
 * null prototypes to handle user-controlled keys such as `__proto__` safely.
 */
export declare function rewriteImportMap(map: unknown, rewrite: (url: string) => string): unknown;
