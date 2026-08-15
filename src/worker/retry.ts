const TRANSIENT_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Epoxy uses Hyper for HTTP/2. A remote GOAWAY with NO_ERROR is a graceful
 * connection shutdown, but a request racing that shutdown can still reject
 * before Hyper establishes a fresh connection.
 */
export function isRetryableHttp2GoAway(error: unknown): boolean {
	const details = errorDetails(error);

	return (
		/\bhttp2\b/i.test(details) &&
		/\bgoaway\b/i.test(details) &&
		/\bno_error\b/i.test(details) &&
		/\bremote\b/i.test(details)
	);
}

/**
 * Transport failures that are safe to retry once on a bodyless GET/HEAD/OPTIONS.
 *
 * Wisp/Epoxy surfaces several of these as a rejected `fetch` rather than an
 * HTTP status: a GOAWAY, a dropped WebSocket, a TLS handshake that lost the
 * race with a connection rotation. Retrying a request that already sent a
 * body is not safe (the origin may have processed it), so the caller still
 * has to pass `hasBody`.
 */
export function isRetryableTransportError(error: unknown): boolean {
	if (isRetryableHttp2GoAway(error)) return true;

	const details = errorDetails(error);
	if (/failed to fetch/i.test(details)) return true;
	if (/\bnetworkerror\b/i.test(details)) return true;
	if (
		/\b(econnreset|econnrefused|etimedout|eai_again|epipe)\b/i.test(
			details
		)
	)
		return true;
	if (/connection (reset|closed|aborted|refused|terminated)/i.test(details))
		return true;
	if (/\bbroken pipe\b/i.test(details)) return true;
	if (/\b(tls|ssl).*(handshake|alert|protocol|closed)/i.test(details))
		return true;
	if (/\bwisp\b/i.test(details) && /\b(closed|reset|error|fail)/i.test(details))
		return true;

	return false;
}

function errorDetails(error: unknown): string {
	return error instanceof Error
		? `${error.message}\n${error.cause ? String(error.cause) : ""}`
		: String(error);
}

export async function retryTransientHttp2Request<T>(
	request: () => Promise<T>,
	method: string,
	hasBody: boolean
): Promise<T> {
	try {
		return await request();
	} catch (error) {
		if (
			hasBody ||
			!TRANSIENT_RETRY_METHODS.has(method.toUpperCase()) ||
			!isRetryableTransportError(error)
		) {
			throw error;
		}

		console.warn("Sherpa: transient transport error; retrying request once");

		return request();
	}
}
