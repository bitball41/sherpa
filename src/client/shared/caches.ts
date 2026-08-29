import { rewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { storagePrefix, unprefixStorageKey } from "@/shared/storage";
import {
	mapCacheRequestSequence,
	matchNamespacedCaches,
	namespaceCacheName,
} from "@/shared/cacheNamespace";
import { toWebIdlString } from "@/shared/urlCodec";

export default function (client: SherpaClient, _self: Self) {
	const prefix = storagePrefix(client.url.origin);
	const nativeRequest = client.natives.store["Request"] as
		| typeof Request
		| undefined;
	const objectToString = Object.prototype.toString;
	const isRequest = (value: unknown) =>
		Boolean(nativeRequest && value instanceof nativeRequest) ||
		(typeof value === "object" &&
			value !== null &&
			objectToString.call(value) === "[object Request]");
	const rewriteRequiredRequest = (value: unknown) =>
		isRequest(value)
			? value
			: rewriteUrl(toWebIdlString(value), client.meta);
	const rewriteOptionalRequest = (args: any[]) => {
		if (args.length === 0 || args[0] === undefined) return;
		args[0] = rewriteRequiredRequest(args[0]);
	};

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
			if (ctx.args.length > 0)
				ctx.args[0] = rewriteRequiredRequest(ctx.args[0]);

			const request = ctx.args[0];
			const options = ctx.args[1] as
				(MultiCacheQueryOptions & { cacheName?: string }) | undefined;
			if (options?.cacheName !== undefined) {
				ctx.args[1] = {
					...options,
					cacheName: namespaceCacheName(prefix, options.cacheName),
				};

				return;
			}

			const storage = ctx.this as CacheStorage;
			ctx.return(
				(async () => {
					const names = (await client.natives.call(
						"CacheStorage.prototype.keys",
						storage
					)) as string[];

					return matchNamespacedCaches(names, prefix, async (name) => {
						return client.natives.call(
							"CacheStorage.prototype.match",
							storage,
							request,
							{ ...options, cacheName: name }
						);
					});
				})()
			);
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
			if (ctx.args.length > 0)
				ctx.args[0] = rewriteRequiredRequest(ctx.args[0]);
		},
	});

	client.Proxy("Cache.prototype.addAll", {
		apply(ctx) {
			ctx.args[0] = mapCacheRequestSequence(
				ctx.args[0],
				(request: RequestInfo | URL) =>
					rewriteRequiredRequest(request) as RequestInfo
			);
		},
	});

	client.Proxy("Cache.prototype.put", {
		apply(ctx) {
			if (ctx.args.length > 0)
				ctx.args[0] = rewriteRequiredRequest(ctx.args[0]);
		},
	});

	client.Proxy("Cache.prototype.match", {
		apply(ctx) {
			if (ctx.args.length > 0)
				ctx.args[0] = rewriteRequiredRequest(ctx.args[0]);
		},
	});

	client.Proxy("Cache.prototype.matchAll", {
		apply(ctx) {
			rewriteOptionalRequest(ctx.args);
		},
	});

	client.Proxy("Cache.prototype.keys", {
		apply(ctx) {
			rewriteOptionalRequest(ctx.args);
		},
	});

	client.Proxy("Cache.prototype.delete", {
		apply(ctx) {
			if (ctx.args.length > 0)
				ctx.args[0] = rewriteRequiredRequest(ctx.args[0]);
		},
	});
}
