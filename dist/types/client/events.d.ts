import type { SherpaClient } from "./index";
/**
 * Union type for all global Sherpa events.
 */
export type SherpaGlobalEvent = SherpaGlobalDownloadEvent;
/**
 * Event class for proxified download interception.
 */
export declare class SherpaGlobalDownloadEvent extends Event {
    type: "download";
    download: SherpaDownload;
    constructor(download: SherpaDownload);
}
/**
 * Map for all global Sherpa events with their corresponding event types.
 */
export type SherpaGlobalEvents = {
    download: SherpaGlobalDownloadEvent;
};
/**
 * Event for proxified download interception.
 */
export type SherpaDownload = {
    filename?: string;
    url: string;
    type: string;
    body: ReadableStream<Uint8Array>;
    length: number;
};
/**
 * Union type for all Sherpa proxified navigation events.
 */
export type SherpaEvent = NavigateEvent | UrlChangeEvent | SherpaContextEvent;
/**
 * Type map for all Sherpa navigation events with their corresponding event types.
 */
export type SherpaEvents = {
    navigate: NavigateEvent;
    urlchange: UrlChangeEvent;
    contextInit: SherpaContextEvent;
};
/**
 * Navigation event class fired when Sherpa frame navigates to a new proxified URL.
 */
export declare class NavigateEvent extends Event {
    type: "navigate";
    url: string;
    constructor(url: string);
}
/**
 * URL change event class fired when the proxified URL changes in a Sherpa frame.
 */
export declare class UrlChangeEvent extends Event {
    type: "urlchange";
    url: string;
    constructor(url: string);
}
/**
 * Event class fired when Sherpa initializes in a frame.
 */
export declare class SherpaContextEvent extends Event {
    type: "contextInit";
    window: Self;
    client: SherpaClient;
    constructor(window: Self, client: SherpaClient);
}
