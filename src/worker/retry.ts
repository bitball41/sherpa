const TRANSIENT_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Epoxy uses Hyper for HTTP/2. A remote GOAWAY with NO_ERROR is a graceful
 * connection shutdown, but a request racing that shutdown can still reject
 * before Hyper establishes a fresh connection.
 */
export function isRetryableHttp2GoAway(error: unknown): boolean {
	const details =
		error instanceof Error
			? `${error.message}\n${error.cause ? String(error.cause) : ""}`
			: String(error);

	return (
		/\bhttp2\b/i.test(details) &&
		/\bgoaway\b/i.test(details) &&
		/\bno_error\b/i.test(details) &&
		/\bremote\b/i.test(details)
	);
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
			!isRetryableHttp2GoAway(error)
		) {
			throw error;
		}

		console.warn(
			"Sherpa: remote HTTP/2 connection closed gracefully; retrying request once"
		);

		return request();
	}
}
