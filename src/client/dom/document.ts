import { rewriteHtml } from "@rewriters/html";
import { SherpaClient } from "@client/index";
import { unrewriteUrl } from "@rewriters/url";
import { rewriteSelectorText } from "@/shared/selectors";

export default function (client: SherpaClient, _self: Self) {
	const tostring = String;

	// Captured before the trap below replaces them, so validating a selector
	// runs the *native* method: going through the trapped one would re-enter
	// this trap and recurse. `matches` is used rather than
	// `CSS.supports("selector(...)")` because the latter takes a single complex
	// selector and answers false for an ordinary selector list.
	const nativeMatches = client.natives.store[
		"Element.prototype.matches"
	] as typeof Element.prototype.matches;
	const probeElement = client.natives.call(
		"Document.prototype.createElement",
		(_self as unknown as Window).document,
		"div"
	) as Element | null;
	const canProbeSelectors =
		typeof nativeMatches === "function" && probeElement !== null;

	/**
	 * Rewritten form of a selector, or the page's own if the rewrite produced
	 * something the selector parser rejects.
	 *
	 * The four methods below sit in front of essentially every DOM query a site
	 * makes, so a selector this mangled into invalid CSS would throw a
	 * `SyntaxError` and take the page down rather than degrade it. Falling back
	 * is exactly the behavior from before selector rewriting existed.
	 *
	 * Sites reuse the same selector strings constantly, so results are cached -
	 * which also keeps the scan and the validation off repeat queries.
	 */
	const selectorCache = new Map<string, string>();
	const SELECTOR_CACHE_LIMIT = 500;

	function selectorFor(original: string): string {
		const cached = selectorCache.get(original);
		if (cached !== undefined) return cached;

		let result = rewriteSelectorText(original);
		if (result !== original && canProbeSelectors) {
			try {
				nativeMatches.call(probeElement, result);
			} catch {
				result = original;
			}
		}

		if (selectorCache.size < SELECTOR_CACHE_LIMIT)
			selectorCache.set(original, result);

		return result;
	}
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
				ctx.args[0] = selectorFor(tostring(ctx.args[0]));
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
