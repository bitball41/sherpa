/**
 * Epoxy uses Hyper for HTTP/2. A remote GOAWAY with NO_ERROR is a graceful
 * connection shutdown, but a request racing that shutdown can still reject
 * before Hyper establishes a fresh connection.
 */
export declare function isRetryableHttp2GoAway(error: unknown): boolean;
export declare function retryTransientHttp2Request<T>(request: () => Promise<T>, method: string, hasBody: boolean): Promise<T>;
