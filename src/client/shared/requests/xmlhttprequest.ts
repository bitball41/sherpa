import { config, flagEnabled } from "@/shared";
import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";

const SYNC_XHR_WATCHDOG_MS = 30_000;

export default function (client: SherpaClient, self: Self) {
	let worker;
	if (self.Worker && flagEnabled("syncxhr", client.url)) {
		worker = client.natives.construct("Worker", config.files.sync);
	}
	const ARGS = Symbol("xhr original args");
	const HEADERS = Symbol("xhr headers");

	client.Proxy("XMLHttpRequest.prototype.open", {
		apply(ctx) {
			if (ctx.args[1]) ctx.args[1] = rewriteUrl(ctx.args[1], client.meta);
			if (ctx.args[2] === undefined) ctx.args[2] = true;
			ctx.this[ARGS] = ctx.args;
		},
	});

	client.Proxy("XMLHttpRequest.prototype.setRequestHeader", {
		apply(ctx) {
			// Let the browser validate the header name/value first. Recording before
			// the native call allowed a caught forbidden-header exception to smuggle
			// that header into the helper worker.
			ctx.call();
			const headers =
				ctx.this[HEADERS] || (ctx.this[HEADERS] = Object.create(null));
			const name = String(ctx.args[0]).toLowerCase();
			const value = String(ctx.args[1]);
			headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
		},
	});

	client.Proxy("XMLHttpRequest.prototype.send", {
		apply(ctx) {
			const args = ctx.this[ARGS];
			if (!args || args[2]) return;

			if (!flagEnabled("syncxhr", client.url)) {
				console.warn("ignoring request - sync xhr disabled in flags");

				return ctx.return(undefined);
			}

			// it's a sync request
			// sync xhr to service worker is not supported
			// there's a nice way of polyfilling this though, we can spin on an atomic using sharedarraybuffer. this will maintain the sync behavior

			//@ts-ignore
			const sab = new SharedArrayBuffer(1024, { maxByteLength: 2147483647 });
			const view = new DataView(sab);

			client.natives.call("Worker.prototype.postMessage", worker, {
				sab,
				args,
				headers: ctx.this[HEADERS],
				body: ctx.args[0],
			});

			const now = performance.now();
			while (view.getUint8(0) === 0) {
				// Keep a finite watchdog in case the helper worker fails before it can
				// release the lock; otherwise this main-thread spin would never end.
				if (performance.now() - now > SYNC_XHR_WATCHDOG_MS) {
					throw new Error("xhr timeout");
				}
				/* spin */
			}

			const status = view.getUint16(1);
			const headersLength = view.getUint32(3);

			const headersab = new Uint8Array(headersLength);
			headersab.set(new Uint8Array(sab.slice(7, 7 + headersLength)));
			const headers = new TextDecoder().decode(headersab);
			const parsedHeaders = new Map<string, string>();
			for (const line of headers.split(/\r?\n/)) {
				const colon = line.indexOf(":");
				if (colon <= 0) continue;
				const name = line.slice(0, colon).trim().toLowerCase();
				const value = line.slice(colon + 1).trim();
				const previous = parsedHeaders.get(name);
				parsedHeaders.set(name, previous ? `${previous}, ${value}` : value);
			}

			const bodyLength = view.getUint32(7 + headersLength);
			const bodyab = new Uint8Array(bodyLength);
			bodyab.set(
				new Uint8Array(
					sab.slice(11 + headersLength, 11 + headersLength + bodyLength)
				)
			);
			const body = new TextDecoder().decode(bodyab);

			// these should be using proxies to not leak scram strings but who cares
			client.RawTrap(ctx.this, "status", {
				get() {
					return status;
				},
			});
			client.RawTrap(ctx.this, "responseText", {
				get() {
					return body;
				},
			});
			client.RawTrap(ctx.this, "response", {
				get() {
					if (ctx.this.responseType === "arraybuffer") return bodyab.buffer;

					return body;
				},
			});
			client.RawTrap(ctx.this, "responseXML", {
				get() {
					const parser = new DOMParser();

					return parser.parseFromString(body, "text/xml");
				},
			});
			client.RawTrap(ctx.this, "getAllResponseHeaders", {
				get() {
					return () => headers;
				},
			});
			client.RawTrap(ctx.this, "getResponseHeader", {
				get() {
					return (header: string) => {
						return parsedHeaders.get(String(header).toLowerCase()) ?? null;
					};
				},
			});

			// send has no return value right
			ctx.return(undefined);
		},
	});

	client.Trap("XMLHttpRequest.prototype.responseURL", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});
}
