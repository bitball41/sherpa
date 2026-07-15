const STORAGE_API_PROPERTIES = new Set([
	"clear",
	"getItem",
	"key",
	"length",
	"removeItem",
	"setItem",
]);

function isStorageApiProperty(property: PropertyKey): boolean {
	return (
		typeof property === "string" &&
		(STORAGE_API_PROPERTIES.has(property) || property in Object.prototype)
	);
}

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

/**
 * Creates a Storage view containing only one virtual origin's entries.
 *
 * The proxy implements the Storage interface's named getter/setter/deleter
 * behavior as well as reflective operations such as `in`, `delete`, and
 * `Object.keys`.
 */
export function createVirtualStorageArea(
	storage: Storage,
	origin: string
): Storage {
	const prefix = storagePrefix(origin);

	const getItem = (key: string) => storage.getItem(prefix + key);
	const setItem = (key: string, value: string) =>
		storage.setItem(prefix + key, value);
	const removeItem = (key: string) => storage.removeItem(prefix + key);
	const clear = () => {
		for (const key of storageKeys(storage, origin)) storage.removeItem(key);
	};
	const key = (index: number) => {
		// Web IDL converts an unsigned long before Storage.key() runs.
		const normalizedIndex = index >>> 0;
		const physicalKey = storageKeys(storage, origin)[normalizedIndex];

		return physicalKey === undefined
			? null
			: unprefixStorageKey(physicalKey, origin);
	};

	const handler: ProxyHandler<Storage> = {
		get(target, property) {
			switch (property) {
				case "getItem":
					return getItem;
				case "setItem":
					return setItem;
				case "removeItem":
					return removeItem;
				case "clear":
					return clear;
				case "key":
					return key;
				case "length":
					return storageKeys(storage, origin).length;
				default:
					if (
						typeof property === "symbol" ||
						isStorageApiProperty(property)
					) {
						return Reflect.get(target, property, target);
					}

					return storage.getItem(prefix + property);
			}
		},

		set(target, property, value) {
			if (typeof property === "symbol") {
				return Reflect.set(target, property, value, target);
			}

			storage.setItem(prefix + property, value);
			return true;
		},

		has(target, property) {
			if (
				typeof property === "symbol" ||
				isStorageApiProperty(property)
			) {
				return Reflect.has(target, property);
			}

			return storage.getItem(prefix + property) !== null;
		},

		deleteProperty(target, property) {
			if (typeof property === "symbol") {
				return Reflect.deleteProperty(target, property);
			}
			if (isStorageApiProperty(property)) return true;

			storage.removeItem(prefix + property);
			return true;
		},

		ownKeys(target) {
			const requiredKeys = Reflect.ownKeys(target).filter(
				(property) =>
					Reflect.getOwnPropertyDescriptor(target, property)?.configurable ===
					false
			);
			const virtualKeys = storageKeys(storage, origin).map((physicalKey) =>
				unprefixStorageKey(physicalKey, origin)
			);

			return Array.from(new Set<string | symbol>([...requiredKeys, ...virtualKeys]));
		},

		getOwnPropertyDescriptor(target, property) {
			if (
				typeof property === "symbol" ||
				isStorageApiProperty(property)
			) {
				return Reflect.getOwnPropertyDescriptor(target, property);
			}

			const value = storage.getItem(prefix + property);
			if (value === null) return undefined;

			return {
				value,
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			if (typeof property === "symbol") {
				return Reflect.defineProperty(target, property, attributes);
			}

			storage.setItem(prefix + property, attributes.value);
			return true;
		},
	};

	return new Proxy(storage, handler);
}

/** A collision-free, filesystem-safe OPFS directory for one virtual origin. */
export function storageDirectoryName(origin: string): string {
	return `sherpa-${encodeURIComponent(origin)}`;
}
