import { rewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { storagePrefix, unprefixStorageKey } from "@/shared/storage";

export default function (client: SherpaClient, _self: Self) {
	const prefix = storagePrefix(client.url.origin);

	client.Proxy("CacheStorage.prototype.open", {
		apply(ctx) {
			ctx.args[0] = prefix + ctx.args[0];
		},
	});

	client.Proxy("CacheStorage.prototype.has", {
		apply(ctx) {
			ctx.args[0] = prefix + ctx.args[0];
		},
	});

	client.Proxy("CacheStorage.prototype.match", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("CacheStorage.prototype.delete", {
		apply(ctx) {
			ctx.args[0] = prefix + ctx.args[0];
		},
	});

	client.Proxy("CacheStorage.prototype.keys", {
		apply(ctx) {
			const result = ctx.call() as Promise<string[]>;
			ctx.return(
				result.then((names) =>
					names
						.filter((name) => name.startsWith(prefix))
						.map((name) => unprefixStorageKey(name, client.url.origin))
				)
			);
		},
	});

	client.Proxy("Cache.prototype.add", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Cache.prototype.addAll", {
		apply(ctx) {
			for (let i = 0; i < ctx.args[0].length; i++) {
				if (
					typeof ctx.args[0][i] === "string" ||
					ctx.args[0][i] instanceof URL
				) {
					ctx.args[0][i] = rewriteUrl(ctx.args[0][i], client.meta);
				}
			}
		},
	});

	client.Proxy("Cache.prototype.put", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Cache.prototype.match", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Cache.prototype.matchAll", {
		apply(ctx) {
			if (
				(ctx.args[0] && typeof ctx.args[0] === "string") ||
				(ctx.args[0] && ctx.args[0] instanceof URL)
			) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Cache.prototype.keys", {
		apply(ctx) {
			if (
				(ctx.args[0] && typeof ctx.args[0] === "string") ||
				(ctx.args[0] && ctx.args[0] instanceof URL)
			) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Cache.prototype.delete", {
		apply(ctx) {
			if (typeof ctx.args[0] === "string" || ctx.args[0] instanceof URL) {
				ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
			}
		},
	});
}
