import { rewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, _self: Self) {
	client.Proxy("Navigator.prototype.sendBeacon", {
		apply(ctx) {
			ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
		},
	});
}
