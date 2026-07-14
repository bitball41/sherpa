import type { SherpaClient } from "@client/index";

/**
 * Union type for all global Sherpa events.
 */
export type SherpaGlobalEvent = SherpaGlobalDownloadEvent;

/**
 * Event class for proxified download interception.
 */
export class SherpaGlobalDownloadEvent extends Event {
	declare type: "download";
	download: SherpaDownload;

	constructor(download: SherpaDownload) {
		super("download");
		this.download = download;
	}
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
export class NavigateEvent extends Event {
	declare type: "navigate";
	url: string;

	constructor(url: string) {
		super("navigate", { cancelable: true });
		this.url = url;
	}
}

/**
 * URL change event class fired when the proxified URL changes in a Sherpa frame.
 */
export class UrlChangeEvent extends Event {
	declare type: "urlchange";
	url: string;

	constructor(url: string) {
		super("urlchange");
		this.url = url;
	}
}

/**
 * Event class fired when Sherpa initializes in a frame.
 */
export class SherpaContextEvent extends Event {
	declare type: "contextInit";
	window: Self;
	client: SherpaClient;

	constructor(window: Self, client: SherpaClient) {
		super("contextInit");
		this.window = window;
		this.client = client;
	}
}
