export function namespaceCacheName(prefix: string, name: unknown): string {
	return prefix + String(name);
}

/**
 * Searches only cache names inside one virtual origin's namespace while
 * preserving native CacheStorage.keys() creation order.
 */
export async function matchNamespacedCaches<T>(
	names: readonly string[],
	prefix: string,
	match: (physicalName: string) => Promise<T | undefined>
): Promise<T | undefined> {
	for (const name of names) {
		if (!name.startsWith(prefix)) continue;

		// CacheStorage.match stops at the first matching cache in creation order.
		// eslint-disable-next-line no-await-in-loop
		const response = await match(name);
		if (response !== undefined) return response;
	}

	return undefined;
}
