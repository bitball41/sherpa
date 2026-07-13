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
				ctx.args[0] = tostring(ctx.args[0]).replace(
					/((?:^|\s)\b\w+\[(?:src|href|data-href))[\^]?(=['"]?(?:https?[:])?\/\/)/,
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
