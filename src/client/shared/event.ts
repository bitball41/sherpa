import { iswindow } from "@client/entry";
import { unrewriteUrl } from "@rewriters/url";
import type {
	AnyFunction,
	EventCallbackEntry,
	SherpaClient,
} from "@client/index";
import { getOwnPropertyDescriptorHandler } from "@client/helpers";
import { storagePrefix } from "@/shared/storage";
import { getVirtualStorageArea } from "@client/dom/storage";

export default function (client: SherpaClient, self: Self) {
	const handlers = {
		message: {
			_init() {
				if (
					typeof this.data === "object" &&
					this.data !== null &&
					("$sherpa$type" in this.data || "sherpa$type" in this.data)
				) {
					// this is a ctl message
					return false;
				}

				return true;
			},
			ports() {
				// don't know why i have to do this?
				return this.ports;
			},
			source() {
				if (this.source === null) return null;

				// const scram: SherpaClient = this.source[SHERPACLIENT];

				// if (scram) return scram.globalProxy;

				return this.source;
			},
			origin() {
				if (
					typeof this.data === "object" &&
					this.data !== null &&
					"$sherpa$origin" in this.data
				)
					return this.data.$sherpa$origin;

				return client.url.origin;
			},
			data() {
				if (
					typeof this.data === "object" &&
					this.data !== null &&
					"$sherpa$data" in this.data
				)
					return this.data.$sherpa$data;

				return this.data;
			},
		},
		hashchange: {
			oldURL() {
				return unrewriteUrl(this.oldURL);
			},
			newURL() {
				return unrewriteUrl(this.newURL);
			},
		},
		storage: {
			_init() {
				if (this.key === null) {
					try {
						return new URL(unrewriteUrl(this.url)).origin === client.url.origin;
					} catch {
						return false;
					}
				}

				return this.key.startsWith(storagePrefix(client.url.origin));
			},
			key() {
				return this.key === null
					? null
					: this.key.slice(storagePrefix(client.url.origin).length);
			},
			url() {
				return unrewriteUrl(this.url);
			},
			storageArea() {
				return getVirtualStorageArea(this.storageArea);
			},
		},
	};

	/** The event currently being delivered to a page listener, if any. */
	let activeEvent: Event | undefined;

	if (iswindow) {
		// Outside a dispatch the page must still see whatever the platform
		// reports, so keep the native accessor as the fallback.
		const nativeEvent =
			client.natives.call(
				"Object.getOwnPropertyDescriptor",
				null,
				self,
				"event"
			) ||
			client.natives.call(
				"Object.getOwnPropertyDescriptor",
				null,
				(self as typeof globalThis & Window).Window.prototype,
				"event"
			);

		Object.defineProperty(self, "event", {
			get() {
				if (activeEvent !== undefined) return activeEvent;

				return nativeEvent?.get?.call(self);
			},
			configurable: true,
		});
	}

	function getListenerFunction(
		listener: any
	): ((...args: any[]) => any) | null {
		if (typeof listener === "function") return listener;
		if (typeof listener !== "object" || listener === null) return null;

		return function (...args: any[]) {
			const handleEvent = listener.handleEvent;
			if (typeof handleEvent === "function") {
				return Reflect.apply(handleEvent, listener, args);
			}
		};
	}

	function wraplistener(listener: (...args: any) => any) {
		return new Proxy(listener, {
			apply(target, that, args) {
				const realEvent: Event = args[0];

				// we only need to handle events dispatched from the browser
				if (realEvent.isTrusted) {
					const type = realEvent.type;

					if (type in handlers) {
						const handler = handlers[type];

						if (handler._init) {
							if (handler._init.call(realEvent) === false) return;
						}

						args[0] = new Proxy(realEvent, {
							get(target, prop, reciever) {
								const value = Reflect.get(target, prop);
								if (prop in handler) {
									return handler[prop].call(target);
								}

								if (typeof value === "function") {
									return new Proxy(value, {
										apply(target, that, args) {
											if (that === reciever) {
												return Reflect.apply(target, realEvent, args);
											}

											return Reflect.apply(target, that, args);
										},
									});
								}

								return value;
							},
							getOwnPropertyDescriptor: getOwnPropertyDescriptorHandler,
						});
					}
				}

				// `window.event` has to report the object the listener was
				// handed, which for message/hashchange/storage is Sherpa's proxy
				// rather than the real event. This used to install a fresh
				// accessor closing over *this* invocation's arguments, guarded by
				// `if (!self.event)` - so the very first dispatch made the
				// property truthy forever and every later read returned that
				// same, long-finished event. It also ran `defineProperty` on the
				// global once per dispatch until then, on paths as hot as
				// `mousemove`. One accessor, installed below, reading a variable
				// that is saved and restored around each dispatch instead.
				const previousEvent = activeEvent;
				activeEvent = args[0];
				try {
					return Reflect.apply(target, that, args);
				} finally {
					activeEvent = previousEvent;
				}
			},
			getOwnPropertyDescriptor: getOwnPropertyDescriptorHandler,
		});
	}

	// Entries live under the target, then under the page's own callback, so
	// neither registration nor removal has to walk every listener the target
	// carries. A callback is normally registered for one or two (type,
	// capture) pairs, so the innermost list stays tiny.
	function entriesFor(target: any, callback: any): EventCallbackEntry[] | null {
		return client.eventcallbacks.get(target)?.get(callback) ?? null;
	}

	function dropEntry(target: any, entry: EventCallbackEntry) {
		const byCallback = client.eventcallbacks.get(target);
		const entries = byCallback?.get(entry.originalCallback);
		if (!entries) return;

		const index = entries.indexOf(entry);
		if (index >= 0) entries.splice(index, 1);
		if (entries.length === 0) byCallback.delete(entry.originalCallback);
	}

	client.Proxy("EventTarget.prototype.addEventListener", {
		apply(ctx) {
			const origlistener = ctx.args[1];
			const listenerFunction = getListenerFunction(origlistener);
			if (!listenerFunction) return;
			const options = ctx.args[2];
			const capture =
				typeof options === "boolean" ? options : Boolean(options?.capture);
			const once = typeof options === "object" && Boolean(options?.once);
			const signal = typeof options === "object" ? options?.signal : undefined;
			if (signal?.aborted) return ctx.return(undefined);

			const type = ctx.args[0] as string;
			const existing = entriesFor(ctx.this, origlistener);
			if (
				existing?.some(
					(entry) => entry.event === type && entry.capture === capture
				)
			) {
				// Same target, type, callback and capture: the DOM would ignore
				// this registration, so Sherpa must not record a second entry
				// either (the first `removeEventListener` would otherwise only
				// undo one of them).
				return ctx.return(undefined);
			}

			const entry: EventCallbackEntry = {
				event: type,
				originalCallback: origlistener,
				proxiedCallback: null as unknown as AnyFunction,
				capture,
				once,
			};

			let proxylistener = wraplistener(listenerFunction);
			if (once) {
				const wrapped = proxylistener;
				proxylistener = new Proxy(wrapped, {
					apply(target, that, args) {
						try {
							return Reflect.apply(target, that, args);
						} finally {
							dropEntry(ctx.this, entry);
						}
					},
				});
			}
			entry.proxiedCallback = proxylistener;

			ctx.args[1] = proxylistener;

			let byCallback = client.eventcallbacks.get(ctx.this);
			if (!byCallback) {
				byCallback = new Map();
				client.eventcallbacks.set(ctx.this, byCallback);
			}
			const entries = byCallback.get(origlistener);
			if (entries) entries.push(entry);
			else byCallback.set(origlistener, [entry]);

			if (signal) {
				ctx.fn.call(
					signal,
					"abort",
					() => {
						dropEntry(ctx.this, entry);
					},
					{ once: true }
				);
			}
		},
	});

	client.Proxy("EventTarget.prototype.removeEventListener", {
		apply(ctx) {
			const origlistener = ctx.args[1];
			if (
				typeof origlistener !== "function" &&
				typeof origlistener !== "object"
			)
				return;
			if (origlistener === null) return;

			const entries = entriesFor(ctx.this, origlistener);
			if (!entries) return;

			const options = ctx.args[2];
			const capture =
				typeof options === "boolean" ? options : Boolean(options?.capture);

			const i = entries.findIndex(
				(e) => e.event === ctx.args[0] && e.capture === capture
			);
			if (i === -1) return;

			const [entry] = entries.splice(i, 1);
			if (entries.length === 0)
				client.eventcallbacks.get(ctx.this)?.delete(origlistener);

			ctx.args[1] = entry.proxiedCallback;
		},
	});

	const targets = [self.self, self.MessagePort.prototype] as Array<any>;
	if (iswindow) targets.push(self.HTMLElement.prototype);
	if (self.Worker) targets.push(self.Worker.prototype);

	for (const target of targets) {
		const keys = Reflect.ownKeys(target);

		for (const key of keys) {
			if (
				typeof key === "string" &&
				key.startsWith("on") &&
				handlers[key.slice(2)]
			) {
				const realOnEvent = Symbol(`sherpa original ${key} function`);
				const descriptor = client.natives.call(
					"Object.getOwnPropertyDescriptor",
					null,
					target,
					key
				);
				if (!descriptor.get || !descriptor.set || !descriptor.configurable)
					continue;

				// these are the `onmessage`, `onclick`, etc. properties
				client.RawTrap(target, key, {
					get(ctx) {
						if (realOnEvent in this) return this[realOnEvent];

						return ctx.get();
					},
					set(ctx, value: any) {
						this[realOnEvent] = value;

						if (typeof value !== "function") return ctx.set(value);

						ctx.set(wraplistener(value));
					},
				});
			}
		}
	}
}
