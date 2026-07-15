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
 * Builds the native RequestInit used inside an emulated service worker. The
 * public Request properties are decorated separately, but these values must
 * also live in the Request's internal slots so `fetch(event.request)` keeps
 * the original credentials/cache/redirect behavior.
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
		referrerPolicy: request.referrerPolicy,
		integrity: request.integrity,
	};

	// `navigate` is reserved for browser-created requests and cannot be passed
	// to the Request constructor. Other modes can and should be preserved.
	init.mode = request.mode === "navigate" ? "same-origin" : request.mode;
	// The empty string explicitly means no referrer; omitting it would restore
	// the Request constructor's "about:client" default.
	init.referrer = request.referrer;

	if (request.body) {
		init.body = request.body;
		init.duplex = "half";
		// Fetch forbids streaming request bodies with keepalive. The public value
		// is still decorated for the handler, but no valid native Request can hold
		// both internal states simultaneously.
	} else {
		init.keepalive = request.keepalive;
	}

	return init;
}
