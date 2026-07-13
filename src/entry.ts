/// <reference types="@rspack/core/module" />

import type { SherpaVersionInfo } from "./types";

/**
 * Hash of the current commit in `bitball41/sherpa` Sherpa was built from.
 */
declare const COMMITHASH: string;
/**
 * Semantic version of the current Sherpa build.
 */
declare const VERSION: string;

/**
 * @category Window Context
 */
export type { SherpaFlags } from "./types";

/**
 * @category Window Context
 */
export type { SherpaInitConfig } from "./types";

/**
 * @category Window Context
 */
export type { SherpaGlobalEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaGlobalDownloadEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaGlobalEvents } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaDownload } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaEvents } from "./client/events";

/**
 * @category Window Context
 */
export type { NavigateEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { UrlChangeEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaContextEvent } from "./client/events";

/**
 * @category Window Context
 */
export type { SherpaController } from "./controller";

/**
 * @category Window Context
 */
export type { SherpaFrame } from "./controller/frame";

/**
 * @category Window Context
 */
export type { SherpaClient } from "./client";

/**
 * @category Service Worker Context
 */
export type { SherpaServiceWorker } from "./worker";

/**
 * @fileoverview Sherpa Entry Point. This module contain global constants and factory functions to load the APIs in the bundle.
 *
 * @categoryDescription Window Context
 * APIs for the main window context, which includes creating Sherpa Frames and the Controller for managing the Sherpa proxy behavior in the SW.
 * @categoryDescription Service Worker Context
 * APIs designed for the service worker context, where the core logic resides. These are the essentials and include the the `SherpaServiceWorker`.
 */

/**
 * Factory function that creates the `SherpaController` class.
 *
 * @returns The `SherpaController` class.
 *
 * @example
 * ```typescript
 * const { SherpaController } = $sherpaLoadController();
 *
 * const sherpa = new SherpaController({
 *   prefix: "/sherpa/"
 * });
 *
 * await sherpa.init();
 *
 * const frame = sherpa.createFrame();
 * document.body.appendChild(frame.frame);
 * frame.go("https://example.com");
 * ```
 *
 * @category Window Context
 */
export function $sherpaLoadController() {
	return require("./controller/index");
}
/**
 * Factory function that creates the `SherpaClient` for controlling sandboxing.
 *
 * @returns The `SherpaClient` class.
 *
 * @example
 * ```typescript
 * const SherpaClient = $sherpaLoadClient();
 *
 * const sherpaClient = new SherpaClient.SherpaClient();
 * ```
 * @category Window Context
 */
export function $sherpaLoadClient() {
	return require("./client/entry");
}
/**
 * Factory function that creates the `SherpaServiceWorker` class.
 *
 * @returns The `SherpaServiceWorker` class.
 *
 * Plain SW example
 * @example
 * ```typescript
 * // In your Service Worker
 * const { SherpaServiceWorker } = $sherpaLoadWorker();
 *
 * const sherpa = new SherpaServiceWorker();
 *
 * self.addEventListener("fetch", async (ev) => {
 *   await sherpa.loadConfig();
 *
 *   if (sherpa.route(ev)) {
 *     ev.respondWith(sherpa.fetch(ev));
 *   }
 * });
 * ```
 *
 * Workbox-powered SW routing example
 * @example
 * ```typescript
 * // In your Service Worker (ensure you are using a bundler for Workbox)
 * // This is more useful for a webOS or if you have Offline PWA support on your proxy site
 * import { registerRoute } from 'workbox-routing';
 *
 * const { SherpaServiceWorker } = $sherpaLoadWorker();
 *
 * const sherpa = new SherpaServiceWorker();
 *
 * registerRoute(
 *   ({ request }) => {
 *     return sherpa.route({ request });
 *   },
 *   async ({ event }) => {
 *     await sherpa.loadConfig();
 *
 *     return sherpa.fetch(event);
 *   }
 * );
 * ```
 *
 * @category Service Worker Context
 */
export function $sherpaLoadWorker() {
	return require("./worker/index");
}

globalThis.$sherpaRequire = function (path: string) {
	return require(path);
};

/**
 * Version information for the current Sherpa build.
 *
 * @category Window Context
 */
export const $sherpaVersion: SherpaVersionInfo = {
	build: COMMITHASH,
	version: VERSION,
};

globalThis.$sherpaLoadController = $sherpaLoadController;
globalThis.$sherpaLoadClient = $sherpaLoadClient;
globalThis.$sherpaLoadWorker = $sherpaLoadWorker;
globalThis.$sherpaVersion = $sherpaVersion;

if ("document" in globalThis && document?.currentScript) {
	document.currentScript.remove();
}
