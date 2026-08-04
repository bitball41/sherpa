import { unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { config } from "@/shared";

export default function (client: SherpaClient, _self: Self) {
	client.Trap("PerformanceEntry.prototype.name", {
		get(ctx) {
			// name is going to be a url typically
			const name = ctx.get() as string;

			if (name && name.startsWith(location.origin + config.prefix)) {
				return unrewriteUrl(name);
			}

			return name;
		},
	});

	// Sherpa's own injected resources, as they appear in a performance entry.
	// Rebuilding this from `config.files` inside the filter meant an
	// `Object.values` allocation and a fresh concatenation for every entry of
	// every `getEntries()` call - and RUM libraries call those on a timer.
	let ownResourcePaths: string[] = [];
	let ownResourceFiles: typeof config.files | null = null;
	const sherpaResourceUrls = () => {
		if (ownResourceFiles !== config.files) {
			ownResourceFiles = config.files;
			ownResourcePaths = Object.values(config.files).map(
				(file) => location.origin + file
			);
		}

		return ownResourcePaths;
	};

	const filterEntries = (entries: PerformanceEntry[]) => {
		const ours = sherpaResourceUrls();

		return entries.filter((entry) => {
			// The raw name: `PerformanceEntry.prototype.name` is trapped above to
			// unrewrite proxied URLs, and going through it here decoded every
			// entry's URL just to compare it against Sherpa's own file paths.
			const name =
				(client.descriptors.get("PerformanceEntry.prototype.name", entry) as
					string | null) ?? entry.name;

			for (const url of ours) {
				if (name.startsWith(url)) return false;
			}

			return true;
		});
	};

	client.Proxy(
		[
			"Performance.prototype.getEntries",
			"Performance.prototype.getEntriesByType",
			"Performance.prototype.getEntriesByName",
			"PerformanceObserverEntryList.prototype.getEntries",
			"PerformanceObserverEntryList.prototype.getEntriesByType",
			"PerformanceObserverEntryList.prototype.getEntriesByName",
		],
		{
			apply(ctx) {
				const entries = ctx.call() as PerformanceEntry[];

				return ctx.return(filterEntries(entries));
			},
		}
	);
}
