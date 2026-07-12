export function storagePrefix(origin: string): string {
	return `${origin}@`;
}

export function storageKeys(storage: Storage, origin: string): string[] {
	const prefix = storagePrefix(origin);
	const keys: string[] = [];

	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (key?.startsWith(prefix)) keys.push(key);
	}

	return keys;
}

export function unprefixStorageKey(key: string, origin: string): string {
	return key.slice(storagePrefix(origin).length);
}

/** A collision-free, filesystem-safe OPFS directory for one virtual origin. */
export function storageDirectoryName(origin: string): string {
	return `sherpa-${encodeURIComponent(origin)}`;
}
