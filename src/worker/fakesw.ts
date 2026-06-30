import { type MessageW2R, type MessageR2W } from "@client/swruntime";

export class FakeServiceWorker {
	syncToken = 0;
	promises: Record<number, (val?: MessageR2W) => void> = {};
	messageChannel = new MessageChannel();
	connected = false;

	constructor(
		public handle: MessagePort,
		public origin: string
	) {
		this.messageChannel.port1.addEventListener("message", (event) => {
			if ("sherpa$type" in event.data) {
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

		const message: MessageW2R = {
			sherpa$type: "fetch",
			sherpa$token: token,
			sherpa$request: {
				url: request.url,
				body: request.body,
				headers: Array.from(request.headers.entries()),
				method: request.method,
				mode: request.mode,
				destinitation: request.destination,
			},
		};

		const transfer = request.body ? [request.body] : [];

		this.handle.postMessage(message, transfer);

		const { sherpa$response: r } = (await new Promise((resolve) => {
			this.promises[token] = resolve;
		})) as MessageR2W;

		if (!r) return false;

		return new Response(r.body, {
			headers: r.headers,
			status: r.status,
			statusText: r.statusText,
		});
	}
}
