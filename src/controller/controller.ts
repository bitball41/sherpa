import {
	codecDecode,
	codecEncode,
	config,
	setConfig,
	DEFAULT_ERROR_PAGE,
} from "@/shared/index";
import { mergeConfig } from "@/shared/config";
import { decodeProxyUrl, encodeProxyUrl } from "@/shared/urlCodec";
import { SherpaConfig, SherpaInitConfig, SherpaDB } from "@/types";
import { SherpaFrame } from "@/controller/frame";
import { MessageW2C } from "@/worker";
import { IDBPDatabase } from "idb";
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
			prefix: "/sherpa/",
			globals: {
				wrapfn: "$sherpa$wrap",
				wrappropertybase: "$sherpa__",
				wrappropertyfn: "$sherpa$prop",
				cleanrestfn: "$sherpa$clean",
				importfn: "$sherpa$import",
				rewritefn: "$sherpa$rewrite",
				metafn: "$sherpa$meta",
				setrealmfn: "$sherpa$setrealm",
				pushsourcemapfn: "$sherpa$pushsourcemap",
				trysetfn: "$sherpa$tryset",
				templocid: "$sherpa$temploc",
				tempunusedid: "$sherpa$tempunused",
			},
			files: {
				wasm: "/sherpa.wasm.wasm",
				all: "/sherpa.all.js",
				sync: "/sherpa.sync.js",
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

	async init(): Promise<void> {
		await this.openIDB();
		navigator.serviceWorker.controller?.postMessage({
			sherpa$type: "loadConfig",
			config,
		});
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
		navigator.serviceWorker.controller?.postMessage({
			sherpa$type: "loadConfig",
			config,
		});
	}

	addEventListener<K extends keyof SherpaGlobalEvents>(
		type: K,
		listener: (event: SherpaGlobalEvents[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void {
		super.addEventListener(type, listener as EventListener, options);
	}
}
