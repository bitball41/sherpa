import { BareMuxConnection } from "@mercuryworkshop/bare-mux";
import { rewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { appendUrlParams } from "@/shared/urlCodec";

export default function (client: SherpaClient, _self: typeof globalThis) {
	client.Proxy("Worker", {
		construct(ctx) {
			ctx.args[0] = appendUrlParams(rewriteUrl(ctx.args[0], client.meta), {
				dest: "worker",
				type: ctx.args[1]?.type === "module" ? "module" : undefined,
			});

			const worker = ctx.call();
			const conn = new BareMuxConnection();

			(async () => {
				const port = await conn.getInnerPort();
				client.natives.call(
					"Worker.prototype.postMessage",
					worker,
					{
						$sherpa$type: "baremuxinit",
						port,
					},
					[port]
				);
			})();
		},
	});

	// sharedworkers can only be constructed from window
	client.Proxy("SharedWorker", {
		construct(ctx) {
			const options = ctx.args[1];
			ctx.args[0] = appendUrlParams(rewriteUrl(ctx.args[0], client.meta), {
				dest: "sharedworker",
				type:
					typeof options === "object" && options?.type === "module"
						? "module"
						: undefined,
			});

			if (options && typeof options === "string")
				ctx.args[1] = `${client.url.origin}@${options}`;

			if (options && typeof options === "object" && options.name) {
				ctx.args[1] = {
					...options,
					name: `${client.url.origin}@${options.name}`,
				};
			}

			const worker = ctx.call();
			const conn = new BareMuxConnection();

			(async () => {
				const port = await conn.getInnerPort();
				client.natives.call(
					"MessagePort.prototype.postMessage",
					worker.port,
					{
						$sherpa$type: "baremuxinit",
						port,
					},
					[port]
				);
			})();
		},
	});

	client.Proxy("Worklet.prototype.addModule", {
		apply(ctx) {
			if (ctx.args[0])
				ctx.args[0] = appendUrlParams(rewriteUrl(ctx.args[0], client.meta), {
					dest: "worklet",
				});
		},
	});
}
