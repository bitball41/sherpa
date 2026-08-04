/**
 * @fileoverview Contains abstractions for using Sherpa under an iframe.
 */
import { SherpaController } from "./index";
import type { SherpaClient } from "../client/index";
import type { SherpaEvents } from "../client/events";
/**
 * An abstraction over proxy iframe creation, which lets you manage instances of Sherpa and not have to worry about the proxy internals, since everything you need is already proxified.
 *
 * @example
 * ```typescript
 * const { SherpaController } = $sherpaLoadController();
 * const sherpa = new SherpaController({ prefix: "/sherpa/" });
 * await sherpa.init();
 *
 * const frame = sherpa.createFrame();
 * document.body.appendChild(frame.frame);
 *
 * // Navigate to a URL
 * frame.go("https://example.com");
 *
 * // Listen for proxified navigation events
 * frame.addEventListener("urlchange", (e) => {
 *   console.log("URL changed to:", e.url);
 * });
 *
 * // Go back
 * frame.back();
 * // Go forward
 * frame.forward();
 * // Reload page
 * frame.reload();
 * ```
 */
export declare class SherpaFrame extends EventTarget {
    private controller;
    frame: HTMLIFrameElement;
    /**
     * Create a SherpaFrame instance. You likely won't need to interact the {@link SherpaFrame.constructor | constructor} directly.
     * You can instead use {@link SherpaController.createFrame} on your existing `SherpaController`.
     *
     * @param controller The `SherpaController` instance that manages this frame with.
     * @param frame The frame to be controlled for you under Sherpa.
     */
    constructor(controller: SherpaController, frame: HTMLIFrameElement);
    /**
     * Returns the {@link SherpaClient} instance running inside the iframe's contentWindow.
     *
     * @returns The `SherpaClient` instance.
     */
    get client(): SherpaClient;
    /**
     * Returns the proxified URL.
     *
     * @returns The proxified URL.
     */
    get url(): URL;
    /**
     * Navigates the iframe to a new URL under Sherpa.
     *
     * @example
     * ```typescript
     * frame.go("https://example.net");
     * ```
     *
     * @param url A real URL to navigate to
     */
    go(url: string | URL): void;
    /**
     * Goes backwards in the browser history.
     */
    back(): void;
    /**
     * Goes forward in the browser history.
     */
    forward(): void;
    /**
     * Reloads the iframe.
     */
    reload(): void;
    /**
     * Binds event listeners to listen for proxified navigation events in Sherpa.
     *
     * @example
     * ```typescript
     * // Listen for URL changes
     * frame.addEventListener("urlchange", (event) => {
     *   console.log("URL changed:", event.url);
     *   document.title = event.url; // Update page title
     * });
     *
     * // Listen for navigation events
     * frame.addEventListener("navigate", (event) => {
     *   console.log("Navigating to:", event.url);
     * });
     * ```
     *
     * @param type Type of event to listen for.
     * @param listener Event listener to dispatch.
     * @param options Options for the event listener.
     */
    addEventListener<K extends keyof SherpaEvents>(type: K, listener: (event: SherpaEvents[K]) => void, options?: boolean | AddEventListenerOptions): void;
}
