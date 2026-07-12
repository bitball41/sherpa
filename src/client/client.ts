import { SherpaFrame } from "@/controller/frame";
import { SHERPACLIENT, SHERPAFRAME } from "@/symbols";
import { getOwnPropertyDescriptorHandler } from "@client/helpers";
import { createLocationProxy } from "@client/location";
import { createWrapFn } from "@client/shared/wrap";
import { NavigateEvent } from "@client/events";
import { rewriteUrl, unrewriteUrl, type URLMeta } from "@rewriters/url";
import { config, flagEnabled } from "@/shared";
import { CookieStore } from "@/shared/cookie";
import { iswindow } from "./entry";
import { SingletonBox } from "./singletonbox";
import BareClient from "@mercuryworkshop/bare-mux";

type NativeStore = {
	store: Record<string, any>;
	call: (target: string, that: any, ...args) => any;
	construct: (target: string, ...args) => any;
};
type DescriptorStore = {
	store: Record<string, PropertyDescriptor>;
	get: (target: string, that: any) => any;
	set: (target: string, that: any, value: any) => void;
};
//eslint-disable-next-line
export type AnyFunction = Function;

export type SherpaModule = {
	enabled: (client: SherpaClient) => boolean | undefined;
	disabled: (client: SherpaClient, self: typeof globalThis) => void | undefined;
	order: number | undefined;
	default: (client: SherpaClient, self: typeof globalThis) => void;
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

export class SherpaClient {
	locationProxy: any;
	serviceWorker: ServiceWorkerContainer;
	// epoxy: EpoxyClient;
	bare: BareClient;

	natives: NativeStore;
	descriptors: DescriptorStore;
	wrapfn: (i: any, ...args: any) => any;

	cookieStore = new CookieStore();

	eventcallbacks: Map<
		any,
		Array<{
			event: string;
			originalCallback: AnyFunction;
			proxiedCallback: AnyFunction;
			capture: boolean;
			once: boolean;
		}>
	> = new Map();

	meta: URLMeta;

	box: SingletonBox;

	constructor(public global: typeof globalThis) {
		if (SHERPACLIENT in global) {
			console.error(
				"attempted to initialize a sherpa client, but one is already loaded - this is very bad"
			);
			throw new Error();
		}

		if (iswindow) {
			try {
				if (SHERPACLIENT in global.parent) {
					this.box = global.parent[SHERPACLIENT].box;
				}
			} catch {}
			try {
				if (SHERPACLIENT in global.top) {
					this.box = global.top[SHERPACLIENT].box;
				}
			} catch {}
			try {
				if (global.opener && SHERPACLIENT in global.opener) {
					this.box = global.opener[SHERPACLIENT].box;
				}
			} catch {}
			if (!this.box) {
				dbg.warn("Creating SingletonBox");
				this.box = new SingletonBox(this);
			}
		} else {
			this.box = new SingletonBox(this);
		}

		this.box.registerClient(this, global as Self);

		/*
		initEpoxy().then(() => {
			let options = new EpoxyClientOptions();
			options.user_agent = navigator.userAgent;
			this.epoxy = new EpoxyClient(config.wisp, options);
		});
		*/

		if (iswindow) {
			// this.bare = new EpoxyClient();
			this.bare = new BareClient();
		} else {
			this.bare = new BareClient(
				new Promise((resolve) => {
					addEventListener("message", ({ data }) => {
						if (typeof data !== "object") return;
						if ("$sherpa$type" in data && data.$sherpa$type === "baremuxinit") {
							resolve(data.port);
						}
					});
				})
			);
		}

		this.serviceWorker = this.global.navigator.serviceWorker;

		if (iswindow) {
			global.document[SHERPACLIENT] = this;
		}

		this.wrapfn = createWrapFn(this, global);
		this.natives = {
			store: new Proxy(
				{},
				{
					get: (target, prop: string) => {
						if (prop in target) {
							return target[prop];
						}

						const split = prop.split(".");
						const realProp = split.pop();
						const realTarget = split.reduce((a, b) => a?.[b], this.global);

						if (!realTarget) return;

						const original = Reflect.get(realTarget, realProp);
						target[prop] = original;

						return target[prop];
					},
				}
			),
			construct(target: string, ...args) {
				const original = this.store[target];
				if (!original) return null;

				return new original(...args);
			},
			call(target: string, that: any, ...args) {
				const original = this.store[target];
				if (!original) return null;

				return original.call(that, ...args);
			},
		};
		this.descriptors = {
			store: new Proxy(
				{},
				{
					get: (target, prop: string) => {
						if (prop in target) {
							return target[prop];
						}

						const split = prop.split(".");
						const realProp = split.pop();
						const realTarget = split.reduce((a, b) => a?.[b], this.global);

						if (!realTarget) return;

						const original = client.natives.call(
							"Object.getOwnPropertyDescriptor",
							null,
							realTarget,
							realProp
						);
						target[prop] = original;

						return target[prop];
					},
				}
			),
			get(target: string, that: any) {
				const original = this.store[target];
				if (!original) return null;

				return original.get.call(that);
			},
			set(target: string, that: any, value: any) {
				const original = this.store[target];
				if (!original) return null;

				original.set.call(that, value);
			},
		};
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const client = this;
		this.meta = {
			get origin() {
				return client.url;
			},
			get base() {
				if (iswindow) {
					const base = client.natives.call(
						"Document.prototype.querySelector",
						client.global.document,
						"base"
					);
					if (base) {
						let url = base.getAttribute("href");
						if (!url) return client.url;
						const frag = url.indexOf("#");
						url = url.substring(0, frag === -1 ? undefined : frag);
						if (!url) return client.url;

						return new URL(url, client.url.href);
					}
				}

				return client.url;
			},
			get topFrameName() {
				if (!iswindow)
					throw new Error("topFrameName was called from a worker?");

				let currentWin = client.global;
				if (currentWin.parent.window == currentWin.window) {
					// we're top level & we don't have a frame name
					return null;
				}

				// find the topmost frame that's controlled by sherpa, stopping before the real top frame
				while (currentWin.parent.window !== currentWin.window) {
					if (!currentWin.parent.window[SHERPACLIENT]) break;
					currentWin = currentWin.parent.window;
				}

				const curclient = currentWin[SHERPACLIENT];
				const frame = curclient.descriptors.get(
					"window.frameElement",
					currentWin
				);
				if (!frame) {
					// we're inside an iframe, but the top frame is sherpa-controlled and top level, so we can't get a top frame name
					return null;
				}
				if (!frame.name) {
					// the top frame is sherpa-controlled, but it has no name. this is user error
					console.error(
						"YOU NEED TO USE `new SherpaFrame()`! DIRECT IFRAMES WILL NOT WORK"
					);

					return null;
				}

				return frame.name;
			},
			get parentFrameName() {
				if (!iswindow)
					throw new Error("parentFrameName was called from a worker?");
				if (client.global.parent.window == client.global.window) {
					// we're top level & we don't have a frame name
					return null;
				}

				const parentWin = client.global.parent.window;
				if (parentWin[SHERPACLIENT]) {
					// we're inside an iframe, and the parent is sherpa-controlled
					const parentClient = parentWin[SHERPACLIENT];
					const frame = parentClient.descriptors.get(
						"window.frameElement",
						parentWin
					);

					if (!frame) {
						// parent is sherpa controlled and top-level. there is no parent frame name
						return null;
					}

					if (!frame.name) {
						// the parent frame is sherpa-controlled, but it has no name. this is user error
						console.error(
							"YOU NEED TO USE `new SherpaFrame()`! DIRECT IFRAMES WILL NOT WORK"
						);

						return null;
					}

					return frame.name;
				} else {
					// we're inside an iframe, and the parent is not sherpa-controlled
					// return our own frame name
					const frame = client.descriptors.get(
						"window.frameElement",
						client.global
					);
					if (!frame.name) {
						// the parent frame is not sherpa-controlled, so we can't get a parent frame name
						console.error(
							"YOU NEED TO USE `new SherpaFrame()`! DIRECT IFRAMES WILL NOT WORK"
						);

						return null;
					}

					return frame.name;
				}
			},
		};
		this.locationProxy = createLocationProxy(this, global);

		global[SHERPACLIENT] = this;
	}

	get frame(): SherpaFrame | null {
		if (!iswindow) return null;
		const frame = this.descriptors.get("window.frameElement", this.global);

		if (!frame) return null; // we're top level
		const sframe = frame[SHERPAFRAME];

		if (!sframe) {
			// we're in a subframe, recurse upward until we find one
			let currentwin = this.global.window;
			while (currentwin.parent !== currentwin) {
				const currentclient = currentwin[SHERPACLIENT];
				const currentFrame = currentclient.descriptors.get(
					"window.frameElement",
					currentwin
				);
				if (!currentFrame) return null; // ??
				if (currentFrame && currentFrame[SHERPAFRAME]) {
					return currentFrame[SHERPAFRAME];
				}
				currentwin = currentwin.parent.window;
			}
		}

		return sframe;
	}
	get isSubframe(): boolean {
		if (!iswindow) return false;
		const frame = this.descriptors.get("window.frameElement", this.global);

		if (!frame) return false; // we're top level
		const sframe = frame[SHERPAFRAME];
		if (!sframe) return true;

		return false;
	}
	loadcookies(cookiestr: string) {
		this.cookieStore.load(cookiestr);
	}

	hook() {
		const context = import.meta.webpackContext(".", {
			recursive: true,
		});

		const modules: SherpaModule[] = [];

		for (const key of context.keys()) {
			const module = context(key) as SherpaModule;
			if (!key.endsWith(".ts")) continue;
			if (
				(key.startsWith("./dom/") && "window" in this.global) ||
				(key.startsWith("./worker/") && "WorkerGlobalScope" in this.global) ||
				key.startsWith("./shared/")
			) {
				modules.push(module);
			}
		}

		modules.sort((a, b) => {
			const aorder = a.order || 0;
			const border = b.order || 0;

			return aorder - border;
		});

		for (const module of modules) {
			if (!module.enabled || module.enabled(this))
				module.default(this, this.global);
			else if (module.disabled) module.disabled(this, this.global);
		}
	}

	get url(): URL {
		return new URL(unrewriteUrl(this.global.location.href));
	}

	set url(url: URL | string) {
		if (url instanceof URL) url = url.toString();

		const ev = new NavigateEvent(url);
		if (this.frame) {
			this.frame.dispatchEvent(ev);
		}
		if (ev.defaultPrevented) return;

		this.global.location.href = rewriteUrl(ev.url, this.meta);
	}

	// below are the utilities for proxying and trapping dom APIs
	// you don't have to understand this it just makes the rest easier
	// i'll document it eventually

	Proxy(name: string | string[], handler: Proxy) {
		if (Array.isArray(name)) {
			for (const n of name) {
				this.Proxy(n, handler);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);
		if (!target) return;

		if (!(name in this.natives.store)) {
			const original = Reflect.get(target, prop);
			this.natives.store[name] = original;
		}

		this.RawProxy(target, prop, handler);
	}
	RawProxy(target: any, prop: string, handler: Proxy) {
		if (!target) return;
		if (!prop) return;
		if (!Reflect.has(target, prop)) return;

		const originalDescriptor = Reflect.getOwnPropertyDescriptor(target, prop);
		const value = Reflect.get(target, prop);
		delete target[prop];

		const h: ProxyHandler<any> = {};

		if (handler.construct) {
			h.construct = function (
				constructor: any,
				args: any[],
				newTarget: AnyFunction
			) {
				let returnValue: any = undefined;
				let earlyreturn = false;

				const ctx: ProxyCtx = {
					fn: constructor,
					this: null,
					args,
					newTarget: newTarget,
					return: (r: any) => {
						earlyreturn = true;
						returnValue = r;
					},
					call: () => {
						earlyreturn = true;
						returnValue = Reflect.construct(ctx.fn, ctx.args, ctx.newTarget);

						return returnValue;
					},
				};

				handler.construct(ctx);

				if (earlyreturn) {
					return returnValue;
				}

				return Reflect.construct(ctx.fn, ctx.args, ctx.newTarget);
			};
		}

		if (handler.apply) {
			h.apply = (fn: any, that: any, args: any[]) => {
				let returnValue: any = undefined;
				let earlyreturn = false;

				const ctx: ProxyCtx = {
					fn,
					this: that,
					args,
					newTarget: null,
					return: (r: any) => {
						earlyreturn = true;
						returnValue = r;
					},
					call: () => {
						earlyreturn = true;
						returnValue = Reflect.apply(ctx.fn, ctx.this, ctx.args);

						return returnValue;
					},
				};

				const pst = Error.prepareStackTrace;

				Error.prepareStackTrace = function (err, s) {
					if (
						s[0].getFileName() &&
						!s[0].getFileName().startsWith(location.origin + config.prefix)
					) {
						return { stack: err.stack };
					}
				};

				try {
					try {
						handler.apply(ctx);
					} catch (err) {
						if (err instanceof Error) {
							if ((err.stack as any) instanceof Object) {
								//@ts-expect-error i'm not going to explain this
								err.stack = err.stack.stack;
								console.error("ERROR FROM SHERPA INTERNALS", err);
								if (!flagEnabled("allowFailedIntercepts", this.url)) {
									throw err;
								}
							} else {
								throw err;
							}
						} else {
							throw err;
						}
					}
				} finally {
					Error.prepareStackTrace = pst;
				}

				if (earlyreturn) {
					return returnValue;
				}

				return Reflect.apply(ctx.fn, ctx.this, ctx.args);
			};
		}

		h.getOwnPropertyDescriptor = getOwnPropertyDescriptorHandler;
		const proxied = new Proxy(value, h);
		if (originalDescriptor && "value" in originalDescriptor) {
			Object.defineProperty(target, prop, {
				...originalDescriptor,
				value: proxied,
			});
		} else {
			Object.defineProperty(target, prop, {
				value: proxied,
				writable: true,
				configurable: true,
				enumerable: false,
			});
		}
	}
	Trap<T>(name: string | string[], descriptor: Trap<T>): PropertyDescriptor {
		if (Array.isArray(name)) {
			for (const n of name) {
				this.Trap(n, descriptor);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);
		if (!target) return;

		const original = this.natives.call(
			"Object.getOwnPropertyDescriptor",
			null,
			target,
			prop
		);
		this.descriptors.store[name] = original;

		return this.RawTrap(target, prop, descriptor);
	}
	RawTrap<T>(
		target: any,
		prop: string,
		descriptor: Trap<T>
	): PropertyDescriptor {
		if (!target) return;
		if (!prop) return;
		if (!Reflect.has(target, prop)) return;

		const oldDescriptor = this.natives.call(
			"Object.getOwnPropertyDescriptor",
			null,
			target,
			prop
		);

		const ctx: TrapCtx<T> = {
			this: null,
			get: function () {
				return oldDescriptor && oldDescriptor.get.call(this.this);
			},
			set: function (v: T) {
				// eslint-disable-next-line @typescript-eslint/no-unused-expressions
				oldDescriptor && oldDescriptor.set.call(this.this, v);
			},
		};

		delete target[prop];

		const desc: PropertyDescriptor = {};

		if (descriptor.get) {
			desc.get = function () {
				ctx.this = this;

				return descriptor.get(ctx);
			};
		} else if (oldDescriptor?.get) {
			desc.get = oldDescriptor.get;
		}

		if (descriptor.set) {
			desc.set = function (v: T) {
				ctx.this = this;

				descriptor.set(ctx, v);
			};
		} else if (oldDescriptor?.set) {
			desc.set = oldDescriptor.set;
		}

		if (descriptor.enumerable) desc.enumerable = descriptor.enumerable;
		else if (oldDescriptor?.enumerable)
			desc.enumerable = oldDescriptor.enumerable;
		if (descriptor.configurable) desc.configurable = descriptor.configurable;
		else if (oldDescriptor?.configurable)
			desc.configurable = oldDescriptor.configurable;

		Object.defineProperty(target, prop, desc);

		return oldDescriptor;
	}
}
