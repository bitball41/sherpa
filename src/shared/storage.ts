export function storagePrefix(host: string): string {
	return `${host}@`;
}

export function storageKeys(storage: Storage, host: string): string[] {
	const prefix = storagePrefix(host);
	const keys: string[] = [];

	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (key?.startsWith(prefix)) keys.push(key);
	}

	return keys;
}

export function unprefixStorageKey(key: string, host: string): string {
	return key.slice(storagePrefix(host).length);
}
