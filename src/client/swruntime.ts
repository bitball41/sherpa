import { SherpaClient } from "@client/index";
import { appendUrlParams } from "@/shared/urlCodec";

export class SherpaServiceWorkerRuntime {
	recvport: MessagePort;
	constructor(public client: SherpaClient) {
		// @ts-ignore
		self.onconnect = (cevent: MessageEvent) => {
			const port = cevent.ports[0];
			dbg.log("sw", "connected");

			port.addEventListener("message", (event) => {
				console.log("sw", event.data);
				if (
					typeof event.data === "object" &&
					event.data !== null &&
					"sherpa$type" in event.data
				) {
					if (event.data.sherpa$type === "init") {
						this.recvport = event.data.sherpa$port;
						this.recvport.postMessage({ sherpa$type: "init" });
					} else {
						handleMessage.call(this, client, event.data, event.ports);
					}
				}
			});

			port.start();
		};
	}

	hook() {
		// The registered scope is threaded through as a query param on this
		// worker's own script URL (see client/dom/serviceworker.ts), since this
		// runtime runs in its own realm with no other channel back to the
		// registering document's state.
		const scopePath = new URL(self.location.href).searchParams.get("scope");
		const scope = scopePath
			? this.client.url.origin + scopePath
			: this.client.url.href;

		// @ts-ignore
		this.client.global.registration = {
			scope,
			active: {
				scriptURL: this.client.url.href,
				state: "activated",
				onstatechange: null,
				onerror: null,

				postMessage: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: (_e: Event): boolean => {
					return false;
				},
			},
			showNotification: async () => {},
			unregister: async () => true,
			//@ts-ignore
			update: async () => {},
			installing: null,
			waiting: null,
		};

		// @ts-ignore
		this.client.global.ServiceWorkerGlobalScope = this.client.global;
	}
}

function handleMessage(
	this: SherpaServiceWorkerRuntime,
	client: SherpaClient,
	data: MessageW2R,
	ports: readonly MessagePort[] = []
) {
	const port = this.recvport;
	const type = data.sherpa$type;
	const handlers = client.eventcallbacks.get(self);

	if (type === "message") {
		const event = new MessageEvent("message", {
			data: data.sherpa$data,
			origin: client.url.origin,
			ports: Array.from(ports),
		});
		client.natives.call("EventTarget.prototype.dispatchEvent", self, event);

		return;
	}

	if (type === "fetch") {
		const token = data.sherpa$token;
		dbg.log("ee", data);
		const fetchhandlers = (handlers || []).filter(
			(event) => event.event === "fetch"
		);
		const request = data.sherpa$request;
		const Request = client.natives.store.Request;
		const init: RequestInit = {
			headers: new Headers(request.headers),
			method: request.method,
			mode: "same-origin",
		};
		if (request.body) {
			init.body = request.body;
			// Chromium requires duplex when a RequestInit body is a ReadableStream.
			(init as RequestInit & { duplex: "half" }).duplex = "half";
		}

		// Keep the native request pointed at Sherpa so fetch(event.request) stays
		// proxied. The Request.url trap exposes the unrewritten URL to site code.
		const fakeRequest = new Request(
			appendUrlParams(request.url, { from: "swruntime" }),
			init
		);

		for (const [property, value] of Object.entries({
			destination: request.destination,
			mode: request.mode,
			credentials: request.credentials,
			cache: request.cache,
			redirect: request.redirect,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy,
			integrity: request.integrity,
			keepalive: request.keepalive,
		})) {
			Object.defineProperty(fakeRequest, property, {
				configurable: true,
				value,
			});
		}

		const fakeFetchEvent: any = new Event("fetch");
		Object.assign(fakeFetchEvent, {
			request: fakeRequest,
			clientId: "",
			resultingClientId: "",
			replacesClientId: "",
			preloadResponse: Promise.resolve(undefined),
			isReload: false,
		});
		let responsePromise: Promise<Response> | null = null;
		let dispatching = true;
		fakeFetchEvent.respondWith = (response: Response | Promise<Response>) => {
			if (!dispatching) {
				throw new DOMException(
					"respondWith() must be called while the fetch event is being dispatched",
					"InvalidStateError"
				);
			}
			if (responsePromise) {
				throw new DOMException(
					"respondWith() has already been called",
					"InvalidStateError"
				);
			}
			responsePromise = Promise.resolve(response);
		};
		fakeFetchEvent.waitUntil = (promise: PromiseLike<unknown>) => {
			if (!dispatching) {
				throw new DOMException(
					"waitUntil() must be called while the fetch event is being dispatched",
					"InvalidStateError"
				);
			}
			void Promise.resolve(promise).catch((error) => {
				console.error("fake service worker lifetime promise failed", error);
			});
		};

		dbg.log("to fn", fakeFetchEvent);
		try {
			for (const handler of fetchhandlers) {
				try {
					handler.proxiedCallback(trustEvent(fakeFetchEvent));
				} catch (error) {
					console.error("fake service worker fetch handler failed", error);
				}
			}
		} finally {
			dispatching = false;
		}

		if (!responsePromise) {
			port.postMessage({
				sherpa$type: "fetch",
				sherpa$token: token,
				sherpa$response: false,
			});

			return;
		}

		responsePromise
			.then((response) => {
				const message: MessageR2W = {
					sherpa$type: "fetch",
					sherpa$token: token,
					sherpa$response: {
						body: response.body,
						headers: Array.from(response.headers.entries()),
						status: response.status,
						statusText: response.statusText,
					},
				};
				const transfer = response.body ? [response.body] : [];
				dbg.log("sw", "responding", message);
				port.postMessage(message, transfer);
			})
			.catch((error) => {
				console.error("fake service worker response failed", error);
				port.postMessage({
					sherpa$type: "fetch",
					sherpa$token: token,
					sherpa$response: {
						error: error instanceof Error ? error.message : String(error),
					},
				});
			});
	}
}

function trustEvent(event: Event): Event {
	return new Proxy(event, {
		get(target, prop, _reciever) {
			if (prop === "isTrusted") return true;

			return Reflect.get(target, prop);
		},
	});
}

export type TransferrableResponse = {
	body: ReadableStream | null;
	headers: [string, string][];
	status: number;
	statusText: string;
};

export type TransferrableResponseError = { error: string };

export type TransferrableRequest = {
	body: ReadableStream | null;
	headers: [string, string][];
	destination: RequestDestination;
	method: Request["method"];
	mode: Request["mode"];
	credentials: RequestCredentials;
	cache: RequestCache;
	redirect: RequestRedirect;
	referrer: string;
	referrerPolicy: ReferrerPolicy;
	integrity: string;
	keepalive: boolean;
	url: string;
};

type FetchResponseMessage = {
	sherpa$type: "fetch";
	sherpa$response: TransferrableResponse | TransferrableResponseError | false;
};

type FetchRequestMessage = {
	sherpa$type: "fetch";
	sherpa$request: TransferrableRequest;
};

type RuntimeMessage = {
	sherpa$type: "message";
	sherpa$data: unknown;
};

// r2w = runtime to (service) worker

type MessageTypeR2W = FetchResponseMessage;
type MessageTypeW2R = FetchRequestMessage;

type MessageCommon = {
	sherpa$type: string;
	sherpa$token: number;
};

export type MessageR2W = MessageCommon & MessageTypeR2W;
export type MessageW2R =
	| (MessageCommon & MessageTypeW2R & { sherpa$port?: MessagePort })
	| RuntimeMessage;
