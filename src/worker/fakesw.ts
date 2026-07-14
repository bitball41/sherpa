import type { MessageR2W, MessageW2R } from "../client/swruntime";

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

type PendingResponse = {
	resolve: (value: MessageR2W | null) => void;
	timeout: ReturnType<typeof setTimeout>;
};

export class FakeServiceWorker {
	syncToken = 0;
	promises = new Map<number, PendingResponse>();
	messageChannel = new MessageChannel();
	connected = false;
	disposed = false;
	handle: MessagePort;
	origin: string;
	scope: string;
	responseTimeoutMs: number;

	constructor(
		handle: MessagePort,
		origin: string,
		scope: string,
		responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
	) {
		this.handle = handle;
		this.origin = origin;
		this.scope = scope;
		this.responseTimeoutMs = responseTimeoutMs;
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
		if (!Number.isSafeInteger(data.sherpa$token)) return;
		const cb = this.promises.get(data.sherpa$token);
		if (cb) {
			this.promises.delete(data.sherpa$token);
			clearTimeout(cb.timeout);
			cb.resolve(data);
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.connected = false;

		for (const pending of this.promises.values()) {
			clearTimeout(pending.timeout);
			pending.resolve(null);
		}
		this.promises.clear();

		this.messageChannel.port1.close();
		this.handle.close();
	}

	postMessage(data: unknown, transfer: Transferable[] = []): boolean {
		if (this.disposed) return false;

		try {
			this.handle.postMessage(
				{
					sherpa$type: "message",
					sherpa$data: data,
				} satisfies MessageW2R,
				transfer
			);

			return true;
		} catch {
			return false;
		}
	}

	async fetch(request: Request): Promise<Response | false> {
		if (this.disposed) return false;

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
				destination: clonedRequest.destination,
				credentials: clonedRequest.credentials,
				cache: clonedRequest.cache,
				redirect: clonedRequest.redirect,
				referrer: clonedRequest.referrer,
				referrerPolicy: clonedRequest.referrerPolicy,
				integrity: clonedRequest.integrity,
				keepalive: clonedRequest.keepalive,
			},
		};

		const response = new Promise<MessageR2W | null>((resolve) => {
			const timeout = setTimeout(() => {
				if (!this.promises.delete(token)) return;
				resolve(null);
			}, this.responseTimeoutMs);
			this.promises.set(token, { resolve, timeout });
		});
		const transfer = clonedRequest.body ? [clonedRequest.body] : [];
		try {
			this.handle.postMessage(message, transfer);
		} catch {
			const pending = this.promises.get(token);
			if (pending) clearTimeout(pending.timeout);
			this.promises.delete(token);

			return false;
		}

		const result = await response;
		if (!result) return false;
		const { sherpa$response: r } = result;

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

/** Replaces an existing registration for the same virtual origin and scope. */
export function replaceFakeServiceWorker(
	workers: FakeServiceWorker[],
	next: FakeServiceWorker
): void {
	const existing = workers.findIndex(
		(worker) => worker.origin === next.origin && worker.scope === next.scope
	);
	if (existing !== -1) {
		workers[existing].dispose();
		workers.splice(existing, 1);
	}
	workers.push(next);
}

/** Removes and disposes one exact virtual-origin registration. */
export function removeFakeServiceWorker(
	workers: FakeServiceWorker[],
	origin: string,
	scope: string
): boolean {
	const index = workers.findIndex(
		(worker) => worker.origin === origin && worker.scope === scope
	);
	if (index === -1) return false;

	workers[index].dispose();
	workers.splice(index, 1);

	return true;
}
