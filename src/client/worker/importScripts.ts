import { rewriteUrl } from "../../shared/rewriters/url";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient) {
	client.Proxy("importScripts", {
		apply(ctx) {
			for (const i in ctx.args) {
				ctx.args[i] = rewriteUrl(ctx.args[i], client.meta);
			}
		},
	});
}
