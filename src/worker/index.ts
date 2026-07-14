/**
 * @fileoverview Contains the core Service Worker logic for Sherpa, which handles the initial request interception and handles client management for the Sherpa service.
 */

import { FakeServiceWorker } from "@/worker/fakesw";
import { handleFetch } from "@/worker/fetch";
import BareClient from "@mercuryworkshop/bare-mux";
import { SherpaConfig } from "@/types";
import { asyncSetWasm } from "@rewriters/wasm";
import { CookieStore } from "@/shared/cookie";
import { getDB } from "@/shared/security/db";
import { codecDecode, setConfig } from "@/shared";
import { SherpaDownload } from "@client/events";
import {
	getClientIdentity,
	getVirtualClientUrl,
	isTrustedControllerClient,
	normalizeVirtualScope,
} from "./messageSecurity";
export * from "./error";
export * from "./fetch";
export * from "./fakesw";

/**
 * Main `SherpaServiceWorker` class created by the `$sherpaLoadWorker` factory, which handles routing the proxy and contains the core logic for request interception.
 */
export class SherpaServiceWorker extends EventTarget {
	/**
	 * `BareClient` instance to fetch requests under a chosen proxy transport.
	 */
	client: BareClient;
	/**
	 * Current SherpaConfig saved in memory.
	 */
	config: SherpaConfig;

	/**
	 * Recorded sync messages in the message queue.
	 */
	syncPool: Record<
		number,
		{
			clientId: string;
			type: MessageW2C["sherpa$type"];
			resolve: (value: MessageC2W) => void;
		}
	> = {};
	/**
	 * Current sync token for collected messages in the queue.
	 */
	synctoken = 0;

	/**
	 * Sherpa's cookie jar for cookie emulation through other storage means, connected to a client.
	 */
	cookieStore = new CookieStore();
	private cookieStoreReady: Promise<void>;

	/**
	 * Fake service worker registrations, so that some sites don't complain.
	 * This will eventually be replaced with a NestedSW feature under a flag in the future, but this will remain for stability even then.
	 */
	serviceWorkers: FakeServiceWorker[] = [];

	/**
	 * Initializes the `BareClient` Sherpa uses to fetch requests under a chosen proxy transport, the cookie jar store for proxifying cookies, and inits the listeners for emulation features and dynamic configs set through the Sherpa Controller.
	 */
	constructor() {
		super();
		this.client = new BareClient();

		this.cookieStoreReady = (async () => {
			const db = await getDB();
			const cookies = await db.get("cookies", "cookies");
			if (cookies) {
				this.cookieStore.load(cookies);
			}
		})().catch((error) => {
			// IndexedDB can be unavailable in private/storage-restricted contexts.
			// Continue with an in-memory jar instead of making every fetch fail.
			console.error("failed to restore Sherpa cookies", error);
		});

		addEventListener("message", (event: ExtendableMessageEvent) => {
			void this.handleMessage(event).catch((error) => {
				console.error("failed to handle Sherpa worker message", error);
			});
		});
	}

	private async handleMessage(event: ExtendableMessageEvent) {
		const data = event.data as MessageC2W;
		if (typeof data !== "object" || data === null || !("sherpa$type" in data))
			return;

		const sender = getClientIdentity(event.source);
		if (!sender) return;

		if ("sherpa$token" in data && data.sherpa$token !== undefined) {
			const pending = this.syncPool[data.sherpa$token];
			if (
				pending &&
				pending.clientId === sender.id &&
				pending.type === data.sherpa$type
			) {
				delete this.syncPool[data.sherpa$token];
				pending.resolve(data);
			}

			return;
		}

		if (data.sherpa$type === "loadConfig") {
			const db = await getDB();
			const storedConfig = await db.get("config", "config");
			if (
				!storedConfig ||
				!isTrustedControllerClient(
					event.source,
					location.origin,
					storedConfig.prefix
				)
			) {
				return;
			}

			// The controller persists config before notifying the worker. Reload
			// that trusted copy instead of evaluating page-controlled codec strings.
			await this.applyConfig(storedConfig);

			return;
		}

		if (!this.config) await this.loadConfig();
		if (!this.config) return;

		const virtualUrl = getVirtualClientUrl(
			event.source,
			location.origin,
			this.config.prefix,
			codecDecode
		);
		if (!virtualUrl) return;

		if (data.sherpa$type === "registerServiceWorker") {
			if (data.origin !== virtualUrl.origin) return;

			const scope = normalizeVirtualScope(data.scope, virtualUrl.origin);
			if (!scope) return;

			this.serviceWorkers.push(
				new FakeServiceWorker(data.port, virtualUrl.origin, scope)
			);

			return;
		}

		if (data.sherpa$type === "cookie") {
			await this.cookieStoreReady;
			this.cookieStore.setCookies([data.cookie], virtualUrl, data.fromJs);
			const db = await getDB();
			await db.put("cookies", JSON.parse(this.cookieStore.dump()), "cookies");
		}
	}

	private async applyConfig(nextConfig: SherpaConfig) {
		const wasmPathChanged =
			!this.config || this.config.files.wasm !== nextConfig.files.wasm;
		this.config = nextConfig;
		setConfig(nextConfig);

		if (wasmPathChanged) await asyncSetWasm();
	}

	/**
	 * Dispatches a message in the message queues.
	 */
	async dispatch(client: Client, data: MessageW2C): Promise<MessageC2W> {
		const token = this.synctoken++;
		let cb: (val: MessageC2W) => void;
		const promise: Promise<MessageC2W> = new Promise((r) => (cb = r));
		this.syncPool[token] = {
			clientId: client.id,
			type: data.sherpa$type,
			resolve: cb,
		};
		data.sherpa$token = token;

		client.postMessage(data);

		return await promise;
	}

	/**
	 * Persists the current Sherpa config into an IndexedDB store.
	 * Remember, this is because the Sherpa config can be dynamically updated via the Sherpa Controller APIs.
	 *
	 * @example
	 * self.addEventListener("fetch", async (ev) => {
	 *   await sherpa.loadConfig();
	 *
	 *   ...
	 * });
	 */
	async loadConfig() {
		if (this.config) return;

		const db = await getDB();
		const storedConfig = await db.get("config", "config");
		if (storedConfig) await this.applyConfig(storedConfig);
	}

	/**
	 * Whether to route a request from a `FetchEvent` in Sherpa.
	 *
	 * @example
	 * self.addEventListener("fetch", async (ev) => {
	 *   ...
	 *
	 *   if (sherpa.route(ev)) {
	 *     ...
	 *   }
	 * });
	 * ```
	 */
	route({ request }: FetchEvent) {
		if (request.url.startsWith(location.origin + this.config.prefix))
			return true;
		else if (request.url.startsWith(location.origin + this.config.files.wasm))
			return true;
		else return false;
	}

	/**
	 * Handles a `FetchEvent` to be routed in Sherpa.
	 * This is the heart of adding Sherpa support to your web proxy.
	 *
	 * @example
	 * self.addEventListener("fetch", async (ev) => {
	 *   ...
	 *
	 *   if (sherpa.route(ev)) {
	 *     ev.respondWith(sherpa.fetch(ev));
	 *   }
	 * });
	 */
	async fetch({ request, clientId }: FetchEvent) {
		if (!this.config) await this.loadConfig();
		await this.cookieStoreReady;

		const client = await self.clients.get(clientId);

		return handleFetch.call(this, request, client);
	}
}

/**
 * Sherpa fake Service Worker event message.
 * Contains a `sherpa$type` for identifying the message.
 */
type RegisterServiceWorkerMessage = {
	sherpa$type: "registerServiceWorker";
	port: MessagePort;
	origin: string;
	scope: string;
};

/**
 * Sherpa cookie jar event message.
 * Contains a `sherpa$type` for identifying the message.
 */
type CookieMessage = {
	sherpa$type: "cookie";
	cookie: string;
	url: string;
	fromJs?: boolean;
};

/**
 * Sherpa config event message.
 * Contains a `sherpa$type` for identifying the message.
 */
type ConfigMessage = {
	sherpa$type: "loadConfig";
	config: SherpaConfig;
};

/**
 * Sherpa proxified download event message.
 * Contains a `sherpa$type` for identifying the message.
 */
type DownloadMessage = {
	sherpa$type: "download";
	download: SherpaDownload;
};
/**
 * Default Sherpa message.
 * Contains a `sherpa$type` for identifying the message.
 */
type MessageCommon = {
	sherpa$token?: number;
};

/**
 * Message types sent from the client to the Service Worker.
 * These are routed by their `sherpa$type` to identify the messages apart from each other.
 */
type MessageTypeC2W =
	RegisterServiceWorkerMessage | CookieMessage | ConfigMessage;
/**
 * w2c (types): Message types sent from the Service Worker to the client.
 */
type MessageTypeW2C = CookieMessage | DownloadMessage;

/** c2w: client to Service Worker */
export type MessageC2W = MessageCommon & MessageTypeC2W;
/** w2c: Service Worker to client */
export type MessageW2C = MessageCommon & MessageTypeW2C;
