import { isemulatedsw } from "@client/entry";
import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient) {
	client.Proxy("fetch", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);

				if (isemulatedsw) ctx.args[0] += "?from=swruntime";
			}
		},
	});

	client.Proxy("Request", {
		construct(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);

				if (isemulatedsw) ctx.args[0] += "?from=swruntime";
			}
		},
	});

	client.Trap("Response.prototype.url", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});

	client.Trap("Request.prototype.url", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});
}
