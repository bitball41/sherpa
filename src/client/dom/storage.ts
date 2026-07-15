import type { SherpaClient } from "@client/index";
import { createVirtualStorageArea } from "@/shared/storage";

const storageAreaProxies = new WeakMap<Storage, Storage>();

export function getVirtualStorageArea(
	storageArea: Storage | null
): Storage | null {
	return storageArea ? storageAreaProxies.get(storageArea) || null : null;
}

export default function (client: SherpaClient, self: typeof window) {
	const namespace = client.url.origin;
	const localStorage = self.localStorage;
	const sessionStorage = self.sessionStorage;
	const localStorageProxy = createVirtualStorageArea(localStorage, namespace);
	const sessionStorageProxy = createVirtualStorageArea(
		sessionStorage,
		namespace
	);

	storageAreaProxies.set(localStorage, localStorageProxy);
	storageAreaProxies.set(sessionStorage, sessionStorageProxy);

	delete self.localStorage;
	delete self.sessionStorage;

	self.localStorage = localStorageProxy;
	self.sessionStorage = sessionStorageProxy;
}
