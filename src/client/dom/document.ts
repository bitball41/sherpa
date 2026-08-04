import { rewriteHtml } from "@rewriters/html";
import { SherpaClient } from "@client/index";
import { unrewriteUrl } from "@rewriters/url";

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
	client.Proxy(
		["Document.prototype.querySelector", "Document.prototype.querySelectorAll"],
		{
			apply(ctx) {
				// A proxied element's `src`/`href` is the rewritten URL, so a
				// prefix match (`[href^="https://…"]`) can never hit; loosening it
				// to a substring match is what makes these selectors keep working.
				// Without the global flag only the *first* such selector in a
				// selector list was loosened, so `a[href^="https://x"],
				// img[src^="https://y"]` silently stopped matching its second half.
				ctx.args[0] = tostring(ctx.args[0]).replace(
					/((?:^|\s)\b\w+\[(?:src|href|data-href))[\^]?(=['"]?(?:https?[:])?\/\/)/g,
					"$1*$2"
				);
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
