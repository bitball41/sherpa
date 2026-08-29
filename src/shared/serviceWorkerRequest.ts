export type TransferredRequestMetadata = {
	body: ReadableStream | null;
	headers: [string, string][];
	method: string;
	mode: RequestMode;
	credentials: RequestCredentials;
	cache: RequestCache;
	redirect: RequestRedirect;
	referrer: string;
	referrerPolicy: ReferrerPolicy;
	integrity: string;
	keepalive: boolean;
};

/**
 * Rebuild a nested service worker Request with the original values in its
 * native internal slots, not merely copied onto public properties.
 */
export function createTransferredRequestInit(
	request: TransferredRequestMetadata
): RequestInit & { duplex?: "half" } {
	const init: RequestInit & { duplex?: "half" } = {
		headers: new Headers(request.headers),
		method: request.method,
		credentials: request.credentials,
		cache: request.cache,
		redirect: request.redirect,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		integrity: request.integrity,
	};

	// `navigate` is browser-only and cannot be passed to Request().
	init.mode = request.mode === "navigate" ? "same-origin" : request.mode;

	if (request.body) {
		init.body = request.body;
		init.duplex = "half";
		// Fetch forbids streaming bodies with keepalive. The public property is
		// still decorated for the nested worker below.
	} else {
		init.keepalive = request.keepalive;
	}

	return init;
}
