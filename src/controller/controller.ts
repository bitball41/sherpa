import {
	codecDecode,
	codecEncode,
	config,
	setConfig,
	DEFAULT_ERROR_PAGE,
} from "@/shared/index";
import { mergeConfig } from "@/shared/config";
import { decodeProxyUrl, encodeProxyUrl } from "@/shared/urlCodec";
import type { SherpaConfig, SherpaInitConfig, SherpaDB } from "@/types";
import { SherpaFrame } from "@/controller/frame";
import { MessageW2C } from "@/worker";
import type { IDBPDatabase } from "idb";
import { SherpaGlobalDownloadEvent, SherpaGlobalEvents } from "@client/events";
import { getDB } from "@/shared/security/db";

export class SherpaController extends EventTarget {
	private db: IDBPDatabase<SherpaDB>;
	private listeningForWorkerMessages = false;
	private readonly handleWorkerMessage = (e: MessageEvent<MessageW2C>) => {
		if (
			typeof e.data !== "object" ||
			e.data === null ||
			!("sherpa$type" in e.data)
		)
			return;

		if (e.data.sherpa$type === "download") {
			this.dispatchEvent(new SherpaGlobalDownloadEvent(e.data.download));
		}
	};

	constructor(config: Partial<SherpaInitConfig>) {
		super();
		// sane ish defaults
		const defaultConfig: SherpaConfig = {
			// wisp: "/wisp/",
			prefix: "/scramjet/",
			// Page-facing wrap identifiers match Scramjet 1.x. They are emitted
			// into every rewritten script; keeping the rare "sherpa" brand here
			// is what made filtered networks block Sherpa-proxied pages while
			// the same sites worked under stock Scramjet.
			globals: {
				wrapfn: "$scramjet$wrap",
				wrappropertybase: "$scramjet__",
				wrappropertyfn: "$scramjet$prop",
				cleanrestfn: "$scramjet$clean",
				importfn: "$scramjet$import",
				rewritefn: "$scramjet$rewrite",
				metafn: "$scramjet$meta",
				setrealmfn: "$scramjet$setrealm",
				pushsourcemapfn: "$scramjet$pushsourcemap",
				trysetfn: "$scramjet$tryset",
				templocid: "$scramjet$temploc",
				tempunusedid: "$scramjet$tempunused",
			},
			files: {
				wasm: "/scramjet.wasm.wasm",
				all: "/scramjet.all.js",
				sync: "/scramjet.sync.js",
			},
			flags: {
				serviceworkers: false,
				syncxhr: false,
				strictRewrites: true,
				rewriterLogs: false,
				captureErrors: true,
				cleanErrors: false,
				scramitize: false,
				sourcemaps: true,
				destructureRewrites: false,
				interceptDownloads: false,
				allowInvalidJs: true,
				allowFailedIntercepts: true,
				responseCache: true,
			},
			siteFlags: {},
			errorPage: { ...DEFAULT_ERROR_PAGE },
			codec: {
				encode: ((url: string) => {
					if (!url) return url;

					return encodeURIComponent(url);
				}).toString(),
				decode: ((url: string) => {
					if (!url) return url;

					return decodeURIComponent(url);
				}).toString(),
			},
		};

		setConfig(mergeConfig(defaultConfig, config));
	}

	/**
	 * Tells the running service worker to re-read the persisted configuration.
	 *
	 * `navigator.serviceWorker.controller` is only set once the *controller
	 * page itself* is controlled by the worker, which it usually isn't: a page
	 * that registers a worker is not controlled by it until the next
	 * navigation, unless the worker calls `clients.claim()`. Posting only to
	 * `controller` therefore dropped the message in the ordinary setup - and
	 * because the worker's `loadConfig()` returns early once it holds a config,
	 * nothing else ever re-read it. Every runtime `modifyConfig` (error-page
	 * theme, feature flags, prefix, codec) silently failed to reach the worker
	 * until the browser restarted it.
	 *
	 * The active worker of the page's own registration is the same worker, and
	 * the message is authenticated in the worker by the sending client's URL
	 * (`isTrustedControllerClient`), not by whether it is controlled, so this
	 * is the same trust boundary either way.
	 */
	private async notifyWorker(): Promise<void> {
		const message = { sherpa$type: "loadConfig", config } as const;

		const controller = navigator.serviceWorker.controller;
		if (controller) {
			controller.postMessage(message);

			return;
		}

		try {
			const registration = await navigator.serviceWorker.getRegistration();
			const worker =
				registration?.active ??
				registration?.waiting ??
				registration?.installing;
			worker?.postMessage(message);
		} catch (error) {
			// No registration yet (or storage access denied): the worker reads the
			// persisted config on its first fetch anyway.
			dbg.log("couldn't reach a service worker to reload config", error);
		}
	}

	async init(): Promise<void> {
		await this.openIDB();
		await this.notifyWorker();
		dbg.log("config loaded");

		if (!this.listeningForWorkerMessages) {
			navigator.serviceWorker.addEventListener(
				"message",
				this.handleWorkerMessage
			);
			this.listeningForWorkerMessages = true;
		}
	}

	createFrame(frame?: HTMLIFrameElement): SherpaFrame {
		if (!frame) {
			frame = document.createElement("iframe");
		}

		return new SherpaFrame(this, frame);
	}

	encodeUrl(url: string | URL): string {
		if (typeof url === "string") url = new URL(url);

		return encodeProxyUrl(url, config.prefix, codecEncode);
	}

	decodeUrl(url: string | URL): string {
		if (url instanceof URL) url = url.toString();
		const prefixed = location.origin + config.prefix;
		if (url.startsWith(prefixed)) {
			return decodeProxyUrl(url, prefixed, codecDecode);
		}

		return decodeProxyUrl(url, config.prefix, codecDecode);
	}

	/**
	 * A URL that renders a live preview of Sherpa's error page using your
	 * current `errorPage` theme, with a sample
	 * trace filled in. Point a frame (or any navigation) at it to see your
	 * customization without having to trigger a real fetch failure.
	 *
	 * @example
	 * ```typescript
	 * const frame = sherpa.createFrame();
	 * document.body.appendChild(frame.frame);
	 * frame.frame.src = sherpa.errorPreviewUrl; // shows the themed error page
	 * ```
	 */
	get errorPreviewUrl(): string {
		return config.prefix + "$error";
	}

	async openIDB(): Promise<IDBPDatabase<SherpaDB>> {
		const db = await getDB();

		this.db = db;
		await this.#saveConfig();

		return db;
	}

	async #saveConfig() {
		if (!this.db) {
			console.error("Store not ready!");

			return;
		}
		await this.db.put("config", config, "config");
	}

	async modifyConfig(newconfig: Partial<SherpaInitConfig>) {
		setConfig(mergeConfig(config, newconfig));

		await this.#saveConfig();
		await this.notifyWorker();
	}

	addEventListener<K extends keyof SherpaGlobalEvents>(
		type: K,
		listener: (event: SherpaGlobalEvents[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void {
		super.addEventListener(type, listener as EventListener, options);
	}
}
