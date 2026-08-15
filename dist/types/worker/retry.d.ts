/**
 * Epoxy uses Hyper for HTTP/2. A remote GOAWAY with NO_ERROR is a graceful
 * connection shutdown, but a request racing that shutdown can still reject
 * before Hyper establishes a fresh connection.
 */
export declare function isRetryableHttp2GoAway(error: unknown): boolean;
/**
 * Transport failures that are safe to retry once on a bodyless GET/HEAD/OPTIONS.
 *
 * Wisp/Epoxy surfaces several of these as a rejected `fetch` rather than an
 * HTTP status: a GOAWAY, a dropped WebSocket, a TLS handshake that lost the
 * race with a connection rotation. Retrying a request that already sent a
 * body is not safe (the origin may have processed it), so the caller still
 * has to pass `hasBody`.
 */
export declare function isRetryableTransportError(error: unknown): boolean;
export declare function retryTransientHttp2Request<T>(request: () => Promise<T>, method: string, hasBody: boolean): Promise<T>;
