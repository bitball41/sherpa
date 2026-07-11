// A `Refresh` directive — whether it arrives as `<meta http-equiv=refresh>`
// content or as the HTTP `Refresh` response header — looks like
// `<seconds>[; url=<url>]`. Browsers honor both, so an un-rewritten URL in
// either one navigates straight to the real, un-proxied target and punches out
// of the proxy. The `url=` key is ASCII case-insensitive and the value may be
// quoted; anything before it (the timeout, separators) is preserved verbatim.

export function rewriteRefresh(
	content: string,
	rewrite: (url: string) => string
): string {
	return content.replace(
		/(url\s*=\s*)([\s\S]*)/i,
		(_match, key: string, rest: string) => {
			const url = rest.trim();
			const quote = /^['"]/.test(url) ? url[0] : "";
			if (quote) {
				const end = url.indexOf(quote, 1);
				const inner = end === -1 ? url.slice(1) : url.slice(1, end);

				return key + quote + rewrite(inner.trim()) + quote;
			}

			return key + rewrite(url);
		}
	);
}
