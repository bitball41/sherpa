export class SherpaHeaders {
	headers: Record<string, string> = Object.create(null);

	set(key: string, v: string) {
		this.headers[key.toLowerCase()] = v;
	}

	delete(key: string) {
		delete this.headers[key.toLowerCase()];
	}
}

export type HeaderValue = string | string[];

// Fetch combines repeated response fields with a comma except for fields whose
// grammar only permits one value. Set-Cookie is consumed by Sherpa's cookie jar
// and must never be exposed on the synthetic response.
const SINGLE_VALUE_RESPONSE_HEADERS = new Set([
	"content-disposition",
	"content-length",
	"content-location",
	"content-type",
	"location",
	"referer",
	"refresh",
]);

export function flattenResponseHeaders(
	headers: Record<string, HeaderValue>
): Record<string, string> {
	const flattened: Record<string, string> = Object.create(null);

	for (const key of Object.keys(headers)) {
		const normalizedKey = key.toLowerCase();
		if (normalizedKey === "set-cookie") continue;

		const value = headers[key];
		if (Array.isArray(value)) {
			if (value.length === 0) continue;
			flattened[normalizedKey] = SINGLE_VALUE_RESPONSE_HEADERS.has(
				normalizedKey
			)
				? value[0]
				: value.join(", ");
		} else {
			flattened[normalizedKey] = value;
		}
	}

	return flattened;
}
