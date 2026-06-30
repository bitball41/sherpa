import { rewriteHtml } from "@rewriters/html";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, _self: Self) {
	client.Proxy("Range.prototype.createContextualFragment", {
		apply(ctx) {
			ctx.args[0] = rewriteHtml(ctx.args[0], client.cookieStore, client.meta);
		},
	});
}
