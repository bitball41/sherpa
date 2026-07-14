import type { SherpaClient } from "@client/index";
import { type MessageC2W } from "@/worker";
import { flagEnabled } from "@/shared";
import { rewriteUrl } from "@rewriters/url";
import { appendUrlParams } from "@/shared/urlCodec";
import {
	resolveServiceWorkerRegistrationUrls,
	ServiceWorkerRegistrationStore,
} from "@/shared/serviceWorkerRegistry";

// we need a late order because we're mangling with addEventListener at a higher level
export const order = 2;

export const enabled = (client: SherpaClient) =>
	flagEnabled("serviceworkers", client.url);

export function disabled(_client: SherpaClient, _self: Self) {
	Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
}

type FakeRegistrationState = {
	scopeURL: URL;
	scriptURL: URL;
	active: ServiceWorker | null;
};

export default function (client: SherpaClient, self: Self) {
	const registrationmap: WeakMap<
		ServiceWorkerRegistration,
		FakeRegistrationState
	> = new WeakMap();
	const registrations =
		new ServiceWorkerRegistrationStore<ServiceWorkerRegistration>();
	let readyResolved = false;
	let resolveReady!: (registration: ServiceWorkerRegistration) => void;
	const ready = new Promise<ServiceWorkerRegistration>((resolve) => {
		resolveReady = resolve;
	});

	function getPhysicalController(): ServiceWorker | null {
		return client.descriptors.get(
			"ServiceWorkerContainer.prototype.controller",
			client.serviceWorker
		) as ServiceWorker | null;
	}

	function matchingRegistration(url: string | URL) {
		return registrations.match(url);
	}

	function maybeResolveReady(registration: ServiceWorkerRegistration) {
		if (readyResolved || matchingRegistration(client.url) !== registration)
			return;
		readyResolved = true;
		resolveReady(registration);
	}

	function decorateActiveWorker(state: FakeRegistrationState): ServiceWorker {
		const active = new EventTarget() as ServiceWorker;
		Object.setPrototypeOf(active, self.ServiceWorker.prototype);

		Object.defineProperties(active, {
			scriptURL: {
				configurable: true,
				enumerable: true,
				get: () => state.scriptURL.href,
			},
			state: {
				configurable: true,
				enumerable: true,
				get: () => "activated",
			},
			onstatechange: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: null,
			},
			onerror: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: null,
			},
			postMessage: {
				configurable: true,
				value: (
					message: unknown,
					transferOrOptions?: Transferable[] | StructuredSerializeOptions
				) => {
					const controller = getPhysicalController();
					if (
						!controller ||
						state.active !== active ||
						registrations.get(state.scopeURL) === undefined
					) {
						throw new DOMException(
							"The Service Worker is no longer active",
							"InvalidStateError"
						);
					}

					const transfer = Array.isArray(transferOrOptions)
						? transferOrOptions
						: (transferOrOptions?.transfer ?? []);
					client.natives.call(
						"ServiceWorker.prototype.postMessage",
						controller,
						{
							sherpa$type: "postServiceWorkerMessage",
							origin: client.url.origin,
							scope: state.scopeURL.pathname,
							message,
							transfer,
						} as MessageC2W,
						transfer
					);
				},
			},
		});

		return active;
	}

	function createRegistration(
		state: FakeRegistrationState
	): ServiceWorkerRegistration {
		const registration = new EventTarget() as ServiceWorkerRegistration;
		Object.setPrototypeOf(
			registration,
			self.ServiceWorkerRegistration.prototype
		);

		Object.defineProperties(registration, {
			scope: {
				configurable: true,
				enumerable: true,
				get: () => state.scopeURL.href,
			},
			installing: {
				configurable: true,
				enumerable: true,
				get: () => null,
			},
			waiting: {
				configurable: true,
				enumerable: true,
				get: () => null,
			},
			active: {
				configurable: true,
				enumerable: true,
				get: () => state.active,
			},
			updateViaCache: {
				configurable: true,
				enumerable: true,
				get: () => "imports",
			},
			update: {
				configurable: true,
				value: () => Promise.resolve(),
			},
			unregister: {
				configurable: true,
				value: async () => {
					if (registrations.get(state.scopeURL) !== registration) return false;
					const controller = getPhysicalController();
					if (!controller) return false;

					try {
						client.natives.call(
							"ServiceWorker.prototype.postMessage",
							controller,
							{
								sherpa$type: "unregisterServiceWorker",
								origin: client.url.origin,
								scope: state.scopeURL.pathname,
							} as MessageC2W
						);
					} catch {
						return false;
					}

					registrations.delete(state.scopeURL, registration);
					state.active = null;

					return true;
				},
			},
		});

		registrationmap.set(registration, state);

		return registration;
	}

	client.Proxy("EventTarget.prototype.addEventListener", {
		apply(ctx) {
			if (registrationmap.get(ctx.this)) {
				// do nothing
				ctx.return(undefined);
			}
		},
	});

	client.Proxy("EventTarget.prototype.removeEventListener", {
		apply(ctx) {
			if (registrationmap.get(ctx.this)) {
				// do nothing
				ctx.return(undefined);
			}
		},
	});

	client.Proxy("ServiceWorkerContainer.prototype.getRegistration", {
		apply(ctx) {
			let url: URL;
			try {
				url = new URL(ctx.args[0] ?? client.url.href, client.url.href);
			} catch (error) {
				ctx.return(Promise.reject(error));

				return;
			}
			if (url.origin !== client.url.origin) {
				ctx.return(
					Promise.reject(
						new DOMException(
							"Service Worker registration lookup must be same-origin",
							"SecurityError"
						)
					)
				);

				return;
			}

			ctx.return(Promise.resolve(matchingRegistration(url)));
		},
	});

	client.Proxy("ServiceWorkerContainer.prototype.getRegistrations", {
		apply(ctx) {
			ctx.return(Promise.resolve(registrations.values()));
		},
	});

	client.Trap("ServiceWorkerContainer.prototype.ready", {
		get(_ctx) {
			return ready;
		},
	});

	client.Trap("ServiceWorkerContainer.prototype.controller", {
		get(_ctx) {
			return matchingRegistration(client.url)?.active ?? null;
		},
	});

	client.Proxy("ServiceWorkerContainer.prototype.register", {
		apply(ctx) {
			ctx.return(
				(async () => {
					const { scriptURL, scopeURL, scopePath } =
						resolveServiceWorkerRegistrationUrls(
							ctx.args[0],
							ctx.args[1]?.scope,
							client.url
						);
					const controller = getPhysicalController();
					if (!controller) {
						throw new DOMException(
							"Sherpa's physical Service Worker is not controlling this page",
							"InvalidStateError"
						);
					}

					const url = appendUrlParams(rewriteUrl(scriptURL.href, client.meta), {
						dest: "serviceworker",
						scope: scopePath,
						type: ctx.args[1]?.type === "module" ? "module" : undefined,
					});
					const worker = client.natives.construct("SharedWorker", url);
					const handle = worker.port as MessagePort;
					let registration = registrations.get(scopeURL);
					let state = registration
						? registrationmap.get(registration)
						: undefined;

					if (!state) {
						state = { scopeURL, scriptURL, active: null };
						registration = createRegistration(state);
					}
					const active = decorateActiveWorker(state);

					client.natives.call(
						"ServiceWorker.prototype.postMessage",
						controller,
						{
							sherpa$type: "registerServiceWorker",
							port: handle,
							origin: client.url.origin,
							scope: scopePath,
						} as MessageC2W,
						[handle]
					);

					state.scopeURL = scopeURL;
					state.scriptURL = scriptURL;
					state.active = active;
					registrations.set(scopeURL, registration);
					maybeResolveReady(registration);

					return registration;
				})()
			);
		},
	});
}
