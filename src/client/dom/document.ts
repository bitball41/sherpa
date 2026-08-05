import { rewriteHtml } from "@rewriters/html";
import { SherpaClient } from "@client/index";
import { unrewriteUrl } from "@rewriters/url";
import { rewriteSelectorText } from "@/shared/selectors";

export default function (client: SherpaClient, _self: Self) {
	const tostring = String;
	const rewriteDocumentArguments = (args: unknown[]) => {
		for (let index = 0; index < args.length; index++) {
			try {
				args[index] = rewriteHtml(
					tostring(args[index]),
					client.cookieStore,
					client.meta,
					false
				);
			} catch {}
		}
	};
	// A proxied element's `src`/`href` attribute holds the *rewritten* URL, so
	// every selector a site writes against its own URLs matched nothing. The
	// previous approach - loosening `^=` to `*=` - could not work with the
	// default codec either, since the rewritten value is percent-encoded and
	// no longer contains the site's URL as a substring at all. Sherpa already
	// keeps the authored value in a `sherpa-attr-*` shadow attribute, so point
	// the selector at that instead; see `rewriteSelectorText`.
	client.Proxy(
		[
			"Document.prototype.querySelector",
			"Document.prototype.querySelectorAll",
			// The same selectors run against elements far more often than
			// against the document, and trapping only `Document.prototype` left
			// every `el.querySelectorAll("a[href^='/']")` broken.
			"Element.prototype.querySelector",
			"Element.prototype.querySelectorAll",
			"Element.prototype.matches",
			"Element.prototype.closest",
			"DocumentFragment.prototype.querySelector",
			"DocumentFragment.prototype.querySelectorAll",
		],
		{
			apply(ctx) {
				if (ctx.args.length === 0) return;
				ctx.args[0] = rewriteSelectorText(tostring(ctx.args[0]));
			},
		}
	);

	client.Proxy("Document.prototype.write", {
		apply(ctx) {
			rewriteDocumentArguments(ctx.args);
		},
	});

	client.Trap("Document.prototype.referrer", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});

	client.Proxy("Document.prototype.writeln", {
		apply(ctx) {
			rewriteDocumentArguments(ctx.args);
		},
	});

	// parseHTMLUnsafe is a *static* method on Document, not on its prototype;
	// trapping the prototype silently did nothing, so injected markup went
	// through unrewritten.
	client.Proxy("Document.parseHTMLUnsafe", {
		apply(ctx) {
			if (ctx.args[0])
				try {
					ctx.args[0] = rewriteHtml(
						ctx.args[0],
						client.cookieStore,
						client.meta,
						false
					);
				} catch {}
		},
	});
}
