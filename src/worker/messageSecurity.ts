export type ClientIdentity = {
	id: string;
	url: string;
};

export type UrlDecoder = (value: string) => string;

function getProxyPrefix(proxyOrigin: string, prefix: string): string | null {
	try {
		const origin = new URL(proxyOrigin);
		const proxyPrefix = new URL(prefix, origin);

		if (proxyPrefix.origin !== origin.origin) return null;

		return proxyPrefix.href;
	} catch {
		return null;
	}
}

/**
 * Extracts the stable identity fields exposed by a Service Worker Client.
 * MessagePort and ServiceWorker sources intentionally fail this check.
 */
export function getClientIdentity(source: unknown): ClientIdentity | null {
	if (typeof source !== "object" || source === null) return null;

	const candidate = source as Record<string, unknown>;
	if (
		typeof candidate.id !== "string" ||
		candidate.id.length === 0 ||
		typeof candidate.url !== "string"
	) {
		return null;
	}

	try {
		new URL(candidate.url);
	} catch {
		return null;
	}

	return { id: candidate.id, url: candidate.url };
}

/**
 * Controller messages are trusted only from same-origin clients outside the
 * configured proxy route. Proxied pages share the physical origin, so checking
 * the origin alone is not a security boundary.
 */
export function isTrustedControllerClient(
	source: unknown,
	proxyOrigin: string,
	prefix: string
): boolean {
	const identity = getClientIdentity(source);
	const proxyPrefix = getProxyPrefix(proxyOrigin, prefix);
	if (!identity || !proxyPrefix) return false;

	const sourceUrl = new URL(identity.url);
	const origin = new URL(proxyOrigin);

	return (
		sourceUrl.origin === origin.origin &&
		!sourceUrl.href.startsWith(proxyPrefix)
	);
}

/**
 * Derives a proxied client's virtual URL from its browser-assigned Client.url.
 * Message payload URLs are never authoritative.
 */
export function getVirtualClientUrl(
	source: unknown,
	proxyOrigin: string,
	prefix: string,
	decode: UrlDecoder
): URL | null {
	const identity = getClientIdentity(source);
	const proxyPrefix = getProxyPrefix(proxyOrigin, prefix);
	if (!identity || !proxyPrefix || !identity.url.startsWith(proxyPrefix))
		return null;

	try {
		const encoded = identity.url.slice(proxyPrefix.length);
		if (/^(?:blob|data):/i.test(encoded)) return null;

		const hashIndex = encoded.indexOf("#");
		const decoded =
			hashIndex === -1
				? decode(encoded)
				: `${decode(encoded.slice(0, hashIndex))}#${decode(
						encoded.slice(hashIndex + 1)
					)}`;
		const url = new URL(decoded);

		if (url.protocol !== "http:" && url.protocol !== "https:") return null;

		return url;
	} catch {
		return null;
	}
}

/**
 * Normalizes a claimed fake-service-worker scope while preventing scheme-
 * relative and cross-origin values from escaping the registering client.
 */
export function normalizeVirtualScope(
	scope: string,
	virtualOrigin: string
): string | null {
	if (typeof scope !== "string" || !scope.startsWith("/")) return null;

	try {
		const normalized = new URL(scope, virtualOrigin);
		if (normalized.origin !== virtualOrigin) return null;

		return normalized.pathname;
	} catch {
		return null;
	}
}
