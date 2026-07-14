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

	const handler: ProxyHandler<Storage> = {
		get(target, prop) {
			switch (prop) {
				case "getItem":
					return (key: string) => {
						return target.getItem(prefix + key);
					};

				case "setItem":
					return (key: string, value: string) => {
						return target.setItem(prefix + key, value);
					};

				case "removeItem":
					return (key: string) => {
						return target.removeItem(prefix + key);
					};

				case "clear":
					return () => {
						for (const key of storageKeys(target, namespace))
							target.removeItem(key);
					};

				case "key":
					return (index: number) => {
						const key = storageKeys(target, namespace)[index];

						return key === undefined
							? null
							: unprefixStorageKey(key, namespace);
					};

				case "length":
					return storageKeys(target, namespace).length;

				default:
					if (prop in Object.prototype || typeof prop === "symbol") {
						return Reflect.get(target, prop);
					}

					return target.getItem(prefix + (prop as string));
			}
		},

		set(target, prop, value) {
			target.setItem(prefix + (prop as string), value);

			return true;
		},

		ownKeys(target) {
			return storageKeys(target, namespace).map((key) =>
				unprefixStorageKey(key, namespace)
			);
		},

		getOwnPropertyDescriptor(target, property) {
			return {
				value: target.getItem(prefix + (property as string)),
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			target.setItem(prefix + (property as string), attributes.value);

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
