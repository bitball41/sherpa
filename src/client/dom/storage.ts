import type { SherpaClient } from "@client/index";
import {
	storageKeys,
	storagePrefix,
	unprefixStorageKey,
} from "@/shared/storage";

const storageAreaProxies = new WeakMap<Storage, Storage>();

export function getVirtualStorageArea(
	storageArea: Storage | null
): Storage | null {
	return storageArea ? storageAreaProxies.get(storageArea) || null : null;
}

export default function (client: SherpaClient, self: typeof window) {
	const namespace = client.url.origin;
	const prefix = storagePrefix(namespace);

	/**
	 * True for a property name that stands for a stored key rather than part of
	 * the `Storage` interface. Symbols never do, and neither do the interface's
	 * own members - `prefix + symbol` would throw outright, and reporting a
	 * descriptor for `getItem` as if it were stored made every reflective read
	 * of the proxy disagree with what `get` actually returns.
	 */
	const isStoredKey = (prop: string | symbol): prop is string =>
		typeof prop === "string" &&
		!(prop in Object.prototype) &&
		!(prop in Storage.prototype);

	// Built once per storage area rather than per property read: `Storage`'s
	// methods are ordinary own properties of the object in the DOM, so
	// `localStorage.getItem === localStorage.getItem` holds there, and code that
	// caches or compares them (or hands one to `Array.prototype.map`) has every
	// right to expect it.
	// Null-prototype, so the membership test below means "is one of these" and
	// not "or anything Object.prototype happens to carry".
	const namespacedMethods = (target: Storage) =>
		Object.assign(Object.create(null), {
			getItem: (key: string) => target.getItem(prefix + key),
			setItem: (key: string, value: string) =>
				target.setItem(prefix + key, value),
			removeItem: (key: string) => target.removeItem(prefix + key),
			clear: () => {
				for (const key of storageKeys(target, namespace))
					target.removeItem(key);
			},
			key: (index: number) => {
				const key = storageKeys(target, namespace)[index];

				return key === undefined ? null : unprefixStorageKey(key, namespace);
			},
		}) as Record<string, unknown>;

	const methodsFor = new WeakMap<Storage, Record<string, unknown>>();

	const handler: ProxyHandler<Storage> = {
		get(target, prop) {
			if (prop === "length") return storageKeys(target, namespace).length;

			if (typeof prop === "string") {
				let methods = methodsFor.get(target);
				if (!methods) {
					methods = namespacedMethods(target);
					methodsFor.set(target, methods);
				}
				if (prop in methods) return methods[prop];
			}

			if (!isStoredKey(prop)) return Reflect.get(target, prop);

			return target.getItem(prefix + prop);
		},

		set(target, prop, value) {
			if (!isStoredKey(prop)) return Reflect.set(target, prop, value);
			target.setItem(prefix + prop, value);

			return true;
		},

		has(target, prop) {
			if (!isStoredKey(prop)) return Reflect.has(target, prop);

			// `"token" in localStorage` is a live check against the store, not
			// against whatever properties the Storage object happens to carry -
			// which, with every key namespaced, was always false.
			return target.getItem(prefix + prop) !== null;
		},

		deleteProperty(target, prop) {
			if (!isStoredKey(prop)) return Reflect.deleteProperty(target, prop);
			target.removeItem(prefix + prop);

			return true;
		},

		ownKeys(target) {
			return storageKeys(target, namespace).map((key) =>
				unprefixStorageKey(key, namespace)
			);
		},

		getOwnPropertyDescriptor(target, property) {
			if (!isStoredKey(property))
				return Reflect.getOwnPropertyDescriptor(target, property);

			const value = target.getItem(prefix + property);
			if (value === null) return undefined;

			return {
				value,
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			if (!isStoredKey(property))
				return Reflect.defineProperty(target, property, attributes);
			target.setItem(prefix + property, attributes.value);

			return true;
		},
	};

	const localStorageProxy = new Proxy(self.localStorage, handler);
	const sessionStorageProxy = new Proxy(self.sessionStorage, handler);
	storageAreaProxies.set(self.localStorage, localStorageProxy);
	storageAreaProxies.set(self.sessionStorage, sessionStorageProxy);

	delete self.localStorage;
	delete self.sessionStorage;

	self.localStorage = localStorageProxy;
	self.sessionStorage = sessionStorageProxy;
}
