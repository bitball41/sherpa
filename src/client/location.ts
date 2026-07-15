import { SherpaClient } from "@client/index";
import { UrlChangeEvent } from "@client/events";
import { rewriteUrl } from "@rewriters/url";
import { iswindow } from "@client/entry";
import { toWebIdlString } from "@/shared/urlCodec";

export function createLocationProxy(
	client: SherpaClient,
	self: typeof globalThis
) {
	const Location = iswindow ? self.Location : self.WorkerLocation;
	// location cannot be Proxy()d
	const fakeLocation: any = {};
	Object.setPrototypeOf(fakeLocation, Location.prototype);
	fakeLocation.constructor = Location;

	// for some reason it's on the object for Location and on the prototype for WorkerLocation??
	const descriptorSource = iswindow ? self.location : Location.prototype;
	const urlprops = [
		"protocol",
		"hash",
		"host",
		"hostname",
		"href",
		"origin",
		"pathname",
		"port",
		"search",
	];
	for (const prop of urlprops) {
		const native = client.natives.call(
			"Object.getOwnPropertyDescriptor",
			null,
			descriptorSource,
			prop
		);
		if (!native) continue;

		const desc: Partial<PropertyDescriptor> = {
			configurable: false,
			enumerable: true,
		};
		if (native.get) {
			desc.get = new Proxy(native.get, {
				apply() {
					return client.url[prop];
				},
			});
		}
		if (native.set) {
			desc.set = new Proxy(native.set, {
				apply(target, that, args) {
					if (prop === "href") {
						// special case
						client.url = args[0];

						return;
					}
					if (prop === "hash") {
						const url = new URL(client.url.href);
						url.hash = args[0];
						client.url = url;
						const ev = new UrlChangeEvent(client.url.href);
						if (!client.isSubframe) client.frame?.dispatchEvent(ev);

						return;
					}
					const url = new URL(client.url.href);
					url[prop] = args[0];
					client.url = url;
				},
			});
		}
		Object.defineProperty(fakeLocation, prop, desc);
	}

	// functions
	fakeLocation.toString = new Proxy(self.location.toString, {
		apply(target, that, args) {
			if (that !== fakeLocation) return Reflect.apply(target, that, args);

			return client.url.href;
		},
	});
	if (self.location.assign)
		fakeLocation.assign = new Proxy(self.location.assign, {
			apply(target, that, args) {
				if (that !== fakeLocation || args.length === 0) {
					return Reflect.apply(target, that, args);
				}
				args[0] = rewriteUrl(toWebIdlString(args[0]), client.meta);
				Reflect.apply(target, self.location, args);

				const urlchangeev = new UrlChangeEvent(client.url.href);
				if (!client.isSubframe) client.frame?.dispatchEvent(urlchangeev);
			},
		});
	if (self.location.reload)
		fakeLocation.reload = new Proxy(self.location.reload, {
			apply(target, that, args) {
				return Reflect.apply(
					target,
					that === fakeLocation ? self.location : that,
					args
				);
			},
		});
	if (self.location.replace)
		fakeLocation.replace = new Proxy(self.location.replace, {
			apply(target, that, args) {
				if (that !== fakeLocation || args.length === 0) {
					return Reflect.apply(target, that, args);
				}
				args[0] = rewriteUrl(toWebIdlString(args[0]), client.meta);
				Reflect.apply(target, self.location, args);

				const urlchangeev = new UrlChangeEvent(client.url.href);
				if (!client.isSubframe) client.frame?.dispatchEvent(urlchangeev);
			},
		});

	return fakeLocation;
}
