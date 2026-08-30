import type { SherpaFrame } from "../controller/frame";
import { type URLMeta } from "../shared/rewriters/url";
import { CookieStore } from "../shared/cookie";
import { SingletonBox } from "./singletonbox";
import BareClient from "@mercuryworkshop/bare-mux";
type NativeStore = {
    store: Record<string, any>;
    call: (target: string, that: any, ...args: any[]) => any;
    construct: (target: string, ...args: any[]) => any;
};
type DescriptorStore = {
    store: Record<string, PropertyDescriptor>;
    get: (target: string, that: any) => any;
    set: (target: string, that: any, value: any) => void;
};
export type AnyFunction = Function;
export type SherpaModule = {
    enabled: (client: SherpaClient) => boolean | undefined;
    disabled: (client: SherpaClient, self: typeof globalThis) => void | undefined;
    order: number | undefined;
    default: (client: SherpaClient, self: typeof globalThis) => void;
};
export type EventCallbackEntry = {
    event: string;
    originalCallback: any;
    proxiedCallback: AnyFunction;
    capture: boolean;
    once: boolean;
};
export type ProxyCtx = {
    fn: AnyFunction;
    this: any;
    args: any[];
    newTarget: AnyFunction;
    return: (r: any) => void;
    call: () => any;
};
export type Proxy = {
    construct?(ctx: ProxyCtx): any;
    apply?(ctx: ProxyCtx): any;
};
export type TrapCtx<T> = {
    this: any;
    get: () => T;
    set: (v: T) => void;
};
export type Trap<T> = {
    writable?: boolean;
    value?: any;
    enumerable?: boolean;
    configurable?: boolean;
    get?: (ctx: TrapCtx<T>) => T;
    set?: (ctx: TrapCtx<T>, v: T) => void;
};
export declare class SherpaClient {
    #private;
    global: typeof globalThis;
    locationProxy: any;
    serviceWorker: ServiceWorkerContainer;
    bare: BareClient;
    natives: NativeStore;
    descriptors: DescriptorStore;
    wrapfn: (i: any, ...args: any) => any;
    cookieStore: CookieStore;
    /**
     * Every listener a page has registered, so `removeEventListener` can find
     * the proxy that was installed in its place.
     *
     * A `WeakMap` keyed by the target, whose entries are keyed by the page's
     * own callback. It used to be a strong `Map<EventTarget, Entry[]>`, which
     * meant two things: every element that ever received a listener was
     * retained for the life of the realm (a single-page app that mounts and
     * discards views leaked all of them), and both `addEventListener` and
     * `removeEventListener` scanned the whole array for the target - so
     * registering n listeners on `document` or `window`, which large sites do
     * by the thousand, cost O(n^2).
     */
    eventcallbacks: WeakMap<any, Map<any, EventCallbackEntry[]>>;
    meta: URLMeta;
    box: SingletonBox;
    constructor(global: typeof globalThis);
    get frame(): SherpaFrame | null;
    get isSubframe(): boolean;
    loadcookies(cookiestr: string): void;
    hook(): void;
    get url(): URL;
    /**
     * The URL relative references in this realm resolve against when the
     * document carries no `<base href>`.
     *
     * Normally that is the document's own URL. `about:blank` and `about:srcdoc`
     * have no URL to resolve against, though: per HTML they inherit their
     * creator's base URL, and a proxied page uses those frames constantly -
     * every ad slot, every widget that builds its contents with
     * `contentDocument.write` or `innerHTML`, every `<iframe srcdoc>`. Sherpa
     * resolved their relative URLs against `about:blank`, which resolves to
     * nothing, so `rewriteUrl` handed the markup straight back and the browser
     * resolved it against the *proxy's* origin instead of the site's.
     *
     * The document's own URL is deliberately left alone: `location.href` in an
     * `about:blank` frame really is `"about:blank"`.
     */
    get fallbackBase(): URL;
    set url(url: URL | string);
    Proxy(name: string | string[], handler: Proxy): void;
    RawProxy(target: any, prop: string, handler: Proxy): void;
    Trap<T>(name: string | string[], descriptor: Trap<T>): PropertyDescriptor;
    RawTrap<T>(target: any, prop: string, descriptor: Trap<T>): PropertyDescriptor;
}
export {};
