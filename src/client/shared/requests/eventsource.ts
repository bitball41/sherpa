import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient) {
	client.Proxy("EventSource", {
		construct(ctx) {
			ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
		},
	});

	client.Trap("EventSource.prototype.url", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});
}
