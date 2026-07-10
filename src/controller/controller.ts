import {
	codecDecode,
	codecEncode,
	config,
	loadCodecs,
	setConfig,
	DEFAULT_ERROR_PAGE,
} from "@/shared/index";
import { SherpaConfig, SherpaInitConfig, SherpaDB } from "@/types";
import { SherpaFrame } from "@/controller/frame";
import { MessageW2C } from "@/worker";
import { openDB, IDBPDatabase } from "idb";
import {
	SherpaGlobalDownloadEvent,
	SherpaGlobalEvents,
} from "@client/events";

export class SherpaController extends EventTarget {
	private db: IDBPDatabase<SherpaDB>;

	constructor(config: Partial<SherpaInitConfig>) {
		super();
		// sane ish defaults
		const defaultConfig: SherpaInitConfig = {
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
				encode: (url: string) => {
					if (!url) return url;

					return encodeURIComponent(url);
				},
				decode: (url: string) => {
					if (!url) return url;

					return decodeURIComponent(url);
				},
			},
		};

		const deepMerge = (target: any, source: any): any => {
			for (const key in source) {
				if (source[key] instanceof Object && key in target) {
					Object.assign(source[key], deepMerge(target[key], source[key]));
				}
			}

			return Object.assign(target || {}, source);
		};

		const newConfig = deepMerge(defaultConfig, config);
		newConfig.codec.encode = newConfig.codec.encode.toString();
		newConfig.codec.decode = newConfig.codec.decode.toString();
		setConfig(newConfig as SherpaConfig);
	}

	async init(): Promise<void> {
		loadCodecs();

		await this.openIDB();
		navigator.serviceWorker.controller?.postMessage({
			sherpa$type: "loadConfig",
			config,
		});
		dbg.log("config loaded");

		navigator.serviceWorker.addEventListener("message", (e) => {
			if (!("sherpa$type" in e.data)) return;
			const data: MessageW2C = e.data;

			if (data.sherpa$type === "download") {
				this.dispatchEvent(new SherpaGlobalDownloadEvent(data.download));
			}
		});
	}

	createFrame(frame?: HTMLIFrameElement): SherpaFrame {
		if (!frame) {
			frame = document.createElement("iframe");
		}

		return new SherpaFrame(this, frame);
	}

	encodeUrl(url: string | URL): string {
		if (typeof url === "string") url = new URL(url);

		if (url.protocol != "http:" && url.protocol != "https:") {
			return url.href;
		}

		const encodedHash = codecEncode(url.hash.slice(1));
		const realHash = encodedHash ? "#" + encodedHash : "";
		url.hash = "";

		return config.prefix + codecEncode(url.href) + realHash;
	}

	decodeUrl(url: string | URL) {
		if (url instanceof URL) url = url.toString();
		const prefixed = location.origin + config.prefix;

		return codecDecode(url.slice(prefixed.length));
	}

	/**
	 * A URL that renders a live preview of Sherpa's error page using your
	 * current {@link SherpaErrorPageConfig | `errorPage`} theme, with a sample
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
		const db = await openDB<SherpaDB>("$sherpa", 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains("config")) {
					db.createObjectStore("config");
				}
				if (!db.objectStoreNames.contains("cookies")) {
					db.createObjectStore("cookies");
				}
				if (!db.objectStoreNames.contains("redirectTrackers")) {
					db.createObjectStore("redirectTrackers");
				}
				if (!db.objectStoreNames.contains("referrerPolicies")) {
					db.createObjectStore("referrerPolicies");
				}
				if (!db.objectStoreNames.contains("publicSuffixList")) {
					db.createObjectStore("publicSuffixList");
				}
			},
		});

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
		setConfig(Object.assign({}, config, newconfig));
		loadCodecs();

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
