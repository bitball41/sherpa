/**
 * Rewrites each URI reference in an RFC 8288 Link header while preserving
 * parameters, quoted commas, and the angle brackets around every target.
 */
export function rewriteLinkHeader(
	value: string,
	rewrite: (url: string) => string
): string {
	return value.replace(/<([^<>]+)>/g, (_match, url: string) => {
		return `<${rewrite(url)}>`;
	});
}
