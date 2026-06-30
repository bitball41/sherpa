import { rewriteCss } from "@rewriters/css";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, _self: Self) {
	client.Proxy("FontFace", {
		construct(ctx) {
			ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
		},
	});
}
