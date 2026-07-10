import { URLMeta, rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { rewriteCssUrls } from "./cssUrls";

export function rewriteCss(css: string, meta: URLMeta) {
	return handleCss("rewrite", css, meta);
}

export function unrewriteCss(css: string) {
	return handleCss("unrewrite", css);
}

// `@import` can take a bare string (`@import "x.css"`) with no `url()` wrapper;
// that form is handled here. `url()` tokens - including those inside an
// `@import url(...)` - are handled by the quote-aware scanner in cssUrls.ts,
// which the `startsWith("url")` guard below then leaves alone.
const Atruleregex =
	/(@import\s+)(url\s*?\(.{0,9999}?\)|['"].{0,9999}?['"]|.{0,9999}?)($|\s|;)/gm;
const importStatementRegex = /^(url\(['"]?|['"]|)(.+?)(['"]|['"]?\)|)$/gm;

function handleCss(type: "rewrite" | "unrewrite", css: string, meta?: URLMeta) {
	css = rewriteCssUrls(css, (url) =>
		type === "rewrite"
			? rewriteUrl(url.trim(), meta!)
			: unrewriteUrl(url.trim())
	);
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
