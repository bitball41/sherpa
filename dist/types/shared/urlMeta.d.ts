/**
 * The URL context a rewrite happens in: the document's own URL and the base
 * that relative URLs resolve against (which a `<base href>` can move).
 *
 * In the service worker this is a plain object built per request. In a proxied
 * page it is backed by accessors on the client, which is why the helper below
 * exists.
 */
export type URLMeta = {
    origin: URL;
    base: URL;
    topFrameName?: string;
    parentFrameName?: string;
};
/**
 * Resolves a {@link URLMeta}'s live accessors once, into a plain mutable
 * object.
 *
 * In the client realm `origin`/`base` are getters that re-read `location`,
 * decode the proxied URL and run a `<base>` lookup on *every* read - and a
 * rewrite pass reads them once per URL it touches, so a stylesheet with fifty
 * `url()` references paid for fifty of them.
 *
 * Resolving once per rewrite is also what the HTML rewriter needs to be
 * correct: it assigns to `base` when it meets a `<base href>`, and assigning
 * to a getter-only meta throws in strict mode - which silently dropped the
 * rewrite of any markup containing a `<base>` element.
 *
 * The frame-name accessors stay lazy: they're only consulted for `target`
 * attributes, and they throw outright in worker realms.
 */
export declare function snapshotMeta(meta: URLMeta): URLMeta;
