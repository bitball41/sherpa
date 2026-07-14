const VALID_PROTOCOL_CHARACTERS =
	"!#$%&'*+-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz|~";
const textEncoder = new TextEncoder();

function syntaxError(message: string): DOMException {
	return new DOMException(message, "SyntaxError");
}

/** Resolve a WebSocket URL against the virtual document's API base URL. */
export function resolveWebSocketUrl(value: unknown, base: string | URL): URL {
	let url: URL;
	try {
		url = new URL(String(value), base);
	} catch {
		throw syntaxError(`Failed to construct WebSocket: '${value}' is not a URL`);
	}

	if (url.protocol === "http:") url.protocol = "ws:";
	else if (url.protocol === "https:") url.protocol = "wss:";

	if (url.protocol !== "ws:" && url.protocol !== "wss:") {
		throw syntaxError("WebSocket URLs must use ws, wss, http, or https");
	}
	// URL.hash cannot distinguish no fragment from an explicitly empty '#'.
	if (url.hash || url.href.endsWith("#")) {
		throw syntaxError("WebSocket URLs cannot contain a fragment");
	}

	return url;
}

/** Apply Web IDL sequence conversion and the WebSocket protocol-token rules. */
export function normalizeWebSocketProtocols(value: unknown): string[] {
	let protocols: string[];
	if (value === undefined) {
		protocols = [];
	} else if (typeof value === "string") {
		protocols = [value];
	} else if (
		typeof value === "object" &&
		value !== null &&
		Symbol.iterator in value
	) {
		protocols = Array.from(value as Iterable<unknown>, String);
	} else {
		protocols = [String(value)];
	}

	const seen = new Set<string>();
	for (const protocol of protocols) {
		if (
			!protocol ||
			![...protocol].every((character) =>
				VALID_PROTOCOL_CHARACTERS.includes(character)
			) ||
			seen.has(protocol)
		) {
			throw syntaxError(
				`Invalid or duplicate WebSocket protocol '${protocol}'`
			);
		}
		seen.add(protocol);
	}

	return protocols;
}

export type WebSocketCloseArguments = {
	code: number | undefined;
	reason: string | undefined;
};

/** Apply Web IDL conversion and the synchronous WebSocket close checks. */
export function normalizeWebSocketCloseArguments(
	codeValue: unknown,
	reasonValue: unknown,
	codePresent: boolean,
	reasonPresent: boolean
): WebSocketCloseArguments {
	let code: number | undefined;
	if (codePresent && codeValue !== undefined) {
		const number = +codeValue;
		const integer = Number.isFinite(number) ? Math.trunc(number) : 0;
		code = ((integer % 65_536) + 65_536) % 65_536;
		if (code !== 1000 && (code < 3000 || code > 4999)) {
			throw new DOMException(
				"WebSocket close codes must be 1000 or between 3000 and 4999",
				"InvalidAccessError"
			);
		}
	}

	const reason = reasonPresent ? String(reasonValue) : undefined;
	if (reason !== undefined && textEncoder.encode(reason).byteLength > 123) {
		throw syntaxError("WebSocket close reasons cannot exceed 123 UTF-8 bytes");
	}

	return { code, reason };
}
