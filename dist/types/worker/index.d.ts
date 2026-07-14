/**
 * @fileoverview Contains the core Service Worker logic for Sherpa, which handles the initial request interception and handles client management for the Sherpa service.
 */
import { FakeServiceWorker } from "./fakesw";
import BareClient from "@mercuryworkshop/bare-mux";
import { SherpaConfig } from "../types";
import { CookieStore } from "../shared/cookie";
import { SherpaDownload } from "../client/events";
export * from "./error";
export * from "./fetch";
export * from "./fakesw";
/**
 * Main `SherpaServiceWorker` class created by the `$sherpaLoadWorker` factory, which handles routing the proxy and contains the core logic for request interception.
 */
export declare class SherpaServiceWorker extends EventTarget {
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
    syncPool: Record<number, {
        clientId: string;
        type: MessageW2C["sherpa$type"];
        resolve: (value: MessageC2W) => void;
        reject: (reason: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>;
    /**
     * Current sync token for collected messages in the queue.
     */
    synctoken: number;
    /**
     * Sherpa's cookie jar for cookie emulation through other storage means, connected to a client.
     */
    cookieStore: CookieStore;
    private cookieStoreReady;
    /**
     * Fake service worker registrations, so that some sites don't complain.
     * This will eventually be replaced with a NestedSW feature under a flag in the future, but this will remain for stability even then.
     */
    serviceWorkers: FakeServiceWorker[];
    /**
     * Initializes the `BareClient` Sherpa uses to fetch requests under a chosen proxy transport, the cookie jar store for proxifying cookies, and inits the listeners for emulation features and dynamic configs set through the Sherpa Controller.
     */
    constructor();
    private handleMessage;
    private applyConfig;
    /**
     * Dispatches a message in the message queues.
     */
    dispatch(client: Client, data: MessageW2C): Promise<MessageC2W>;
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
    loadConfig(): Promise<void>;
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
    route({ request }: FetchEvent): boolean;
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
    fetch({ request, clientId }: FetchEvent): Promise<any>;
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
type UnregisterServiceWorkerMessage = {
    sherpa$type: "unregisterServiceWorker";
    origin: string;
    scope: string;
};
type PostServiceWorkerMessage = {
    sherpa$type: "postServiceWorkerMessage";
    origin: string;
    scope: string;
    message: unknown;
    transfer: Transferable[];
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
type MessageTypeC2W = RegisterServiceWorkerMessage | UnregisterServiceWorkerMessage | PostServiceWorkerMessage | CookieMessage | ConfigMessage;
/**
 * w2c (types): Message types sent from the Service Worker to the client.
 */
type MessageTypeW2C = CookieMessage | DownloadMessage;
/** c2w: client to Service Worker */
export type MessageC2W = MessageCommon & MessageTypeC2W;
/** w2c: Service Worker to client */
export type MessageW2C = MessageCommon & MessageTypeW2C;
