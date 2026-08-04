import type { SherpaInitConfig, SherpaDB } from "../types";
import { SherpaFrame } from "./frame";
import type { IDBPDatabase } from "idb";
import { SherpaGlobalEvents } from "../client/events";
export declare class SherpaController extends EventTarget {
    #private;
    private db;
    private listeningForWorkerMessages;
    private readonly handleWorkerMessage;
    constructor(config: Partial<SherpaInitConfig>);
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
    private notifyWorker;
    init(): Promise<void>;
    createFrame(frame?: HTMLIFrameElement): SherpaFrame;
    encodeUrl(url: string | URL): string;
    decodeUrl(url: string | URL): string;
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
    get errorPreviewUrl(): string;
    openIDB(): Promise<IDBPDatabase<SherpaDB>>;
    modifyConfig(newconfig: Partial<SherpaInitConfig>): Promise<void>;
    addEventListener<K extends keyof SherpaGlobalEvents>(type: K, listener: (event: SherpaGlobalEvents[K]) => void, options?: boolean | AddEventListenerOptions): void;
}
