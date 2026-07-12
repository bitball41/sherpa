import { SherpaClient } from "@client/index";
import { storagePrefix, unprefixStorageKey } from "@/shared/storage";

export default function (client: SherpaClient) {
	const prefix = storagePrefix(client.url.origin);

	client.Proxy("IDBFactory.prototype.open", {
		apply(ctx) {
			ctx.args[0] = prefix + ctx.args[0];
		},
	});

	client.Proxy("IDBFactory.prototype.deleteDatabase", {
		apply(ctx) {
			ctx.args[0] = prefix + ctx.args[0];
		},
	});

	client.Proxy("IDBFactory.prototype.databases", {
		apply(ctx) {
			const result = ctx.call() as Promise<IDBDatabaseInfo[]>;
			ctx.return(
				result.then((databases) =>
					databases
						.filter((database) => database.name?.startsWith(prefix))
						.map((database) => ({
							...database,
							name: unprefixStorageKey(database.name, client.url.origin),
						}))
				)
			);
		},
	});

	client.Trap("IDBDatabase.prototype.name", {
		get(ctx) {
			const name = ctx.get() as string;

			return name.startsWith(prefix)
				? unprefixStorageKey(name, client.url.origin)
				: name;
		},
	});
}
