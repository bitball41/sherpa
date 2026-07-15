import { SherpaClient } from "@client/index";
import { SHERPACLIENT } from "@/symbols";
import { rewriteUrl } from "@rewriters/url";
import { toWebIdlString } from "@/shared/urlCodec";

export default function (client: SherpaClient) {
	client.Proxy("window.open", {
		apply(ctx) {
			if (ctx.args.length > 0 && ctx.args[0] !== undefined) {
				const url = toWebIdlString(ctx.args[0]);
				ctx.args[0] = url === "" ? url : rewriteUrl(url, client.meta);
			}

			if (ctx.args[1] === "_top" || ctx.args[1] === "_unfencedTop") {
				ctx.args[1] = client.meta.topFrameName ?? ctx.args[1];
			}
			if (ctx.args[1] === "_parent") {
				ctx.args[1] = client.meta.parentFrameName ?? ctx.args[1];
			}

			const realwin = ctx.call();

			if (!realwin) return ctx.return(realwin);

			if (SHERPACLIENT in realwin) {
				return ctx.return(realwin[SHERPACLIENT].global);
			} else {
				const newclient = new SherpaClient(realwin);
				// hook the opened window
				newclient.hook();

				return ctx.return(newclient.global);
			}
		},
	});

	client.Trap("window.frameElement", {
		get(ctx) {
			const f = ctx.get() as HTMLIFrameElement | null;
			if (!f) return f;

			const win = f.ownerDocument.defaultView;
			if (win[SHERPACLIENT]) {
				// then this is a subframe in a sherpa context, and it's safe to pass back the real iframe
				return f;
			} else {
				// no, the top frame is outside the sandbox
				return null;
			}
		},
	});
}
