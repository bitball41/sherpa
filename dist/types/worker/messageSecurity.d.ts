export type ClientIdentity = {
    id: string;
    url: string;
};
export type UrlDecoder = (value: string) => string;
/**
 * Extracts the stable identity fields exposed by a Service Worker Client.
 * MessagePort and ServiceWorker sources intentionally fail this check.
 */
export declare function getClientIdentity(source: unknown): ClientIdentity | null;
/**
 * Controller messages are trusted only from same-origin clients outside the
 * configured proxy route. Proxied pages share the physical origin, so checking
 * the origin alone is not a security boundary.
 */
export declare function isTrustedControllerClient(source: unknown, proxyOrigin: string, prefix: string): boolean;
/**
 * Derives a proxied client's virtual URL from its browser-assigned Client.url.
 * Message payload URLs are never authoritative.
 */
export declare function getVirtualClientUrl(source: unknown, proxyOrigin: string, prefix: string, decode: UrlDecoder): URL | null;
/**
 * Normalizes a claimed fake-service-worker scope while preventing scheme-
 * relative and cross-origin values from escaping the registering client.
 */
export declare function normalizeVirtualScope(scope: string, virtualOrigin: string): string | null;
