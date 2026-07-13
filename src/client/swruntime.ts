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
						handleMessage.call(this, client, event.data);
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
	data: MessageW2R
) {
	const port = this.recvport;
	const type = data.sherpa$type;
	const token = data.sherpa$token;
	const handlers = client.eventcallbacks.get(self);

	if (type === "fetch") {
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

		Object.defineProperty(fakeRequest, "destination", {
			value: request.destinitation,
		});

		const fakeFetchEvent: any = new Event("fetch");
		fakeFetchEvent.request = fakeRequest;
		let responsePromise: Promise<Response> | null = null;
		fakeFetchEvent.respondWith = (response: Response | Promise<Response>) => {
			if (responsePromise) {
				throw new DOMException(
					"respondWith() has already been called",
					"InvalidStateError"
				);
			}
			responsePromise = Promise.resolve(response);
		};

		dbg.log("to fn", fakeFetchEvent);
		for (const handler of fetchhandlers) {
			try {
				handler.proxiedCallback(trustEvent(fakeFetchEvent));
			} catch (error) {
				console.error("fake service worker fetch handler failed", error);
			}
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
	destinitation: RequestDestination;
	method: Request["method"];
	mode: Request["mode"];
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

// r2w = runtime to (service) worker

type MessageTypeR2W = FetchResponseMessage;
type MessageTypeW2R = FetchRequestMessage;

type MessageCommon = {
	sherpa$type: string;
	sherpa$token: number;
};

export type MessageR2W = MessageCommon & MessageTypeR2W;
export type MessageW2R = MessageCommon &
	MessageTypeW2R & { sherpa$port?: MessagePort };
