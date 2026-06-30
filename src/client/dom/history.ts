import { rewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { UrlChangeEvent } from "@client/events";
import { SHERPACLIENT } from "@/symbols";

export default function (client: SherpaClient, _self: Self) {
	client.Proxy(
		["History.prototype.pushState", "History.prototype.replaceState"],
		{
			apply(ctx) {
				if (ctx.args[2] || ctx.args[2] === "")
					ctx.args[2] = rewriteUrl(ctx.args[2], client.meta);
				ctx.call();
				const {
					constructor: { constructor: Function },
				} = ctx.this;
				const callerGlobalThisProxied: Self = Function("return globalThis")();
				const callerClient = callerGlobalThisProxied[SHERPACLIENT];

				if (callerGlobalThisProxied.name === client.meta.topFrameName) {
					const ev = new UrlChangeEvent(callerClient.url.href);
					client.frame?.dispatchEvent(ev);
				}
			},
		}
	);
}
