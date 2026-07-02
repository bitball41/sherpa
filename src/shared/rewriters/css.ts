import { URLMeta, rewriteUrl, unrewriteUrl } from "@rewriters/url";

export function rewriteCss(css: string, meta: URLMeta) {
	return handleCss("rewrite", css, meta);
}

export function unrewriteCss(css: string) {
	return handleCss("unrewrite", css);
}

// regex from vk6 (https://github.com/ading2210), quotes split into capture
// groups so replacement can rebuild the match without rescanning it
const urlRegex = /url\((['"]?)(.+?)(['"]?)\)/gm;
const Atruleregex =
	/(@import\s+)(url\s*?\(.{0,9999}?\)|['"].{0,9999}?['"]|.{0,9999}?)($|\s|;)/gm;
const importStatementRegex = /^(url\(['"]?|['"]|)(.+?)(['"]|['"]?\)|)$/gm;

function handleCss(type: "rewrite" | "unrewrite", css: string, meta?: URLMeta) {
	// String#replace with a callback compiles each regex once (module scope)
	// and rebuilds every match from its capture groups directly - the old
	// implementation rescanned each match (`match.replace(url, ...)`), which
	// was quadratic in match length and corrupted output when the rewritten
	// URL contained replacement patterns like `$&`.
	css = css.replace(urlRegex, (_match, open, url, close) => {
		const encodedUrl =
			type === "rewrite"
				? rewriteUrl(url.trim(), meta)
				: unrewriteUrl(url.trim());

		return `url(${open}${encodedUrl}${close})`;
	});
	css = css.replace(Atruleregex, (_match, atImport, importStatement, term) => {
		const rewrittenStatement = importStatement.replace(
			importStatementRegex,
			(match, firstQuote, url, endQuote) => {
				if (firstQuote.startsWith("url")) {
					return match;
				}
				const encodedUrl =
					type === "rewrite"
						? rewriteUrl(url.trim(), meta)
						: unrewriteUrl(url.trim());

				return `${firstQuote}${encodedUrl}${endQuote}`;
			}
		);

		return `${atImport}${rewrittenStatement}${term}`;
	});

	return css;
}
