import { SherpaClient } from "@client/index";

/**
 * Union type for all global Sherpa events.
 */
export type SherpaGlobalEvent = SherpaGlobalDownloadEvent;

/**
 * Event class for proxified download interception.
 */
export class SherpaGlobalDownloadEvent extends Event {
	type = "download";
	constructor(public download: SherpaDownload) {
		super("download");
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
	type = "navigate";
	constructor(public url: string) {
		super("navigate");
	}
}

/**
 * URL change event class fired when the proxified URL changes in a Sherpa frame.
 */
export class UrlChangeEvent extends Event {
	type = "urlchange";
	constructor(public url: string) {
		super("urlchange");
	}
}

/**
 * Event class fired when Sherpa initializes in a frame.
 */
export class SherpaContextEvent extends Event {
	type = "contextInit";
	constructor(
		public window: Self,
		public client: SherpaClient
	) {
		super("contextInit");
	}
}
