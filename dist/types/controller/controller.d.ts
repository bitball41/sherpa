import { SherpaInitConfig, SherpaDB } from "../types";
import { SherpaFrame } from "./frame";
import { IDBPDatabase } from "idb";
import { SherpaGlobalEvents } from "../client/events";
export declare class SherpaController extends EventTarget {
    #private;
    private db;
    constructor(config: Partial<SherpaInitConfig>);
    init(): Promise<void>;
    createFrame(frame?: HTMLIFrameElement): SherpaFrame;
    encodeUrl(url: string | URL): string;
    decodeUrl(url: string | URL): string;
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
    get errorPreviewUrl(): string;
    openIDB(): Promise<IDBPDatabase<SherpaDB>>;
    modifyConfig(newconfig: Partial<SherpaInitConfig>): Promise<void>;
    addEventListener<K extends keyof SherpaGlobalEvents>(type: K, listener: (event: SherpaGlobalEvents[K]) => void, options?: boolean | AddEventListenerOptions): void;
}
