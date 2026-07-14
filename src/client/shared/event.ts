import { iswindow } from "@client/entry";
import { unrewriteUrl } from "@rewriters/url";
import type { SherpaClient } from "@client/index";
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

				if (!self.event) {
					Object.defineProperty(self, "event", {
						get() {
							return args[0];
						},
						configurable: true,
					});
				}

				const rv = Reflect.apply(target, that, args);

				return rv;
			},
			getOwnPropertyDescriptor: getOwnPropertyDescriptorHandler,
		});
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
			let arr = client.eventcallbacks.get(ctx.this);
			arr ||= [];
			if (
				arr.some(
					(entry) =>
						entry.event === ctx.args[0] &&
						entry.originalCallback === origlistener &&
						entry.capture === capture
				)
			) {
				return ctx.return(undefined);
			}
			let proxylistener = wraplistener(listenerFunction);
			if (once) {
				const wrapped = proxylistener;
				proxylistener = new Proxy(wrapped, {
					apply(target, that, args) {
						try {
							return Reflect.apply(target, that, args);
						} finally {
							const callbacks = client.eventcallbacks.get(ctx.this);
							const index = callbacks?.findIndex(
								(entry) => entry.proxiedCallback === proxylistener
							);
							if (index !== undefined && index >= 0) callbacks.splice(index, 1);
						}
					},
				});
			}

			ctx.args[1] = proxylistener;
			arr.push({
				event: ctx.args[0] as string,
				originalCallback: origlistener,
				proxiedCallback: proxylistener,
				capture,
				once,
			});
			client.eventcallbacks.set(ctx.this, arr);
			if (signal) {
				ctx.fn.call(
					signal,
					"abort",
					() => {
						const callbacks = client.eventcallbacks.get(ctx.this);
						const index = callbacks?.findIndex(
							(entry) => entry.proxiedCallback === proxylistener
						);
						if (index !== undefined && index >= 0) callbacks.splice(index, 1);
					},
					{ once: true }
				);
			}
		},
	});

	client.Proxy("EventTarget.prototype.removeEventListener", {
		apply(ctx) {
			if (!getListenerFunction(ctx.args[1])) return;

			const arr = client.eventcallbacks.get(ctx.this);
			if (!arr) return;
			const options = ctx.args[2];
			const capture =
				typeof options === "boolean" ? options : Boolean(options?.capture);

			const i = arr.findIndex(
				(e) =>
					e.event === ctx.args[0] &&
					e.originalCallback === ctx.args[1] &&
					e.capture === capture
			);
			if (i === -1) return;

			const r = arr.splice(i, 1);
			client.eventcallbacks.set(ctx.this, arr);

			ctx.args[1] = r[0].proxiedCallback;
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
