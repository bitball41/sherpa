const ENCODED_PATH_SEPARATOR = /%2f|%5c/i;

export type ServiceWorkerRegistrationUrls = {
	scriptURL: URL;
	scopeURL: URL;
	scopePath: string;
};

function validateServiceWorkerUrl(url: URL, documentURL: URL, label: string) {
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.origin !== documentURL.origin
	) {
		throw new DOMException(
			`${label} must use the document's HTTP(S) origin`,
			"SecurityError"
		);
	}
	if (ENCODED_PATH_SEPARATOR.test(url.pathname)) {
		throw new DOMException(
			`${label} cannot contain an encoded slash or backslash`,
			"SecurityError"
		);
	}
}

/** Resolve and validate the URLs accepted by ServiceWorkerContainer.register. */
export function resolveServiceWorkerRegistrationUrls(
	script: string | URL,
	explicitScope: string | undefined,
	document: string | URL
): ServiceWorkerRegistrationUrls {
	const documentURL = new URL(document);
	const scriptURL = new URL(String(script), documentURL);
	validateServiceWorkerUrl(scriptURL, documentURL, "Service Worker script URL");
	scriptURL.hash = "";

	const scopeURL = explicitScope
		? new URL(explicitScope, documentURL)
		: new URL(".", scriptURL);
	validateServiceWorkerUrl(scopeURL, documentURL, "Service Worker scope URL");
	// The nested-worker transport currently routes by pathname. Rejecting query
	// and fragment components avoids silently widening a narrower claimed scope.
	if (scopeURL.search || scopeURL.hash) {
		throw new DOMException(
			"Service Worker scopes with a query or fragment are not supported",
			"NotSupportedError"
		);
	}

	return { scriptURL, scopeURL, scopePath: scopeURL.pathname };
}

/** Ordered registration store with the spec's longest-scope match behavior. */
export class ServiceWorkerRegistrationStore<T> {
	private registrations = new Map<string, T>();

	get(scope: string | URL): T | undefined {
		return this.registrations.get(String(scope));
	}

	set(scope: string | URL, registration: T): void {
		this.registrations.set(String(scope), registration);
	}

	delete(scope: string | URL, expected?: T): boolean {
		const key = String(scope);
		if (expected !== undefined && this.registrations.get(key) !== expected)
			return false;

		return this.registrations.delete(key);
	}

	values(): T[] {
		return Array.from(this.registrations.values());
	}

	match(client: string | URL): T | undefined {
		const clientURL = new URL(client);
		let best: { length: number; registration: T } | undefined;

		for (const [scope, registration] of this.registrations) {
			const scopeURL = new URL(scope);
			if (
				scopeURL.origin !== clientURL.origin ||
				!clientURL.href.startsWith(scopeURL.href)
			)
				continue;
			if (!best || scopeURL.href.length > best.length) {
				best = { length: scopeURL.href.length, registration };
			}
		}

		return best?.registration;
	}
}
