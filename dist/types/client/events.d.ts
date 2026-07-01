import { SherpaClient } from "./index";
/**
 * Union type for all global Sherpa events.
 */
export type SherpaGlobalEvent = SherpaGlobalDownloadEvent;
/**
 * Event class for proxified download interception.
 */
export declare class SherpaGlobalDownloadEvent extends Event {
    download: SherpaDownload;
    type: string;
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
    url: string;
    type: string;
    constructor(url: string);
}
/**
 * URL change event class fired when the proxified URL changes in a Sherpa frame.
 */
export declare class UrlChangeEvent extends Event {
    url: string;
    type: string;
    constructor(url: string);
}
/**
 * Event class fired when Sherpa initializes in a frame.
 */
export declare class SherpaContextEvent extends Event {
    window: Self;
    client: SherpaClient;
    type: string;
    constructor(window: Self, client: SherpaClient);
}
