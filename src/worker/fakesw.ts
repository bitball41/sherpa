import { type MessageW2R, type MessageR2W } from "@client/swruntime";

export class FakeServiceWorker {
	syncToken = 0;
	promises: Record<number, (val?: MessageR2W) => void> = {};
	messageChannel = new MessageChannel();
	connected = false;

	constructor(
		public handle: MessagePort,
		public origin: string,
		public scope: string
	) {
		this.messageChannel.port1.addEventListener("message", (event) => {
			if (
				typeof event.data === "object" &&
				event.data !== null &&
				"sherpa$type" in event.data
			) {
				if (event.data.sherpa$type === "init") {
					this.connected = true;
				} else {
					this.handleMessage(event.data);
				}
			}
		});
		this.messageChannel.port1.start();

		this.handle.postMessage(
			{
				sherpa$type: "init",
				sherpa$port: this.messageChannel.port2,
			},
			[this.messageChannel.port2]
		);
	}

	handleMessage(data: MessageR2W) {
		const cb = this.promises[data.sherpa$token];
		if (cb) {
			cb(data);
			delete this.promises[data.sherpa$token];
		}
	}

	async fetch(request: Request): Promise<Response | false> {
		const token = this.syncToken++;
		// Transferring a stream detaches it. Transfer a clone so falling through to
		// the normal transport still has the original request body available.
		const clonedRequest = request.clone();

		const message: MessageW2R = {
			sherpa$type: "fetch",
			sherpa$token: token,
			sherpa$request: {
				url: clonedRequest.url,
				body: clonedRequest.body,
				headers: Array.from(clonedRequest.headers.entries()),
				method: clonedRequest.method,
				mode: clonedRequest.mode,
				destinitation: clonedRequest.destination,
			},
		};

		const response = new Promise<MessageR2W>((resolve) => {
			this.promises[token] = resolve;
		});
		const transfer = clonedRequest.body ? [clonedRequest.body] : [];
		this.handle.postMessage(message, transfer);

		const { sherpa$response: r } = await response;

		if (!r) return false;
		if ("error" in r) {
			throw new Error(`nested service worker response failed: ${r.error}`);
		}

		return new Response(r.body, {
			headers: r.headers,
			status: r.status,
			statusText: r.statusText,
		});
	}
}
