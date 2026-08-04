import { SherpaClient } from "@client/index";
import { SHADOW_ATTRIBUTE_PREFIX } from "@rewriters/html";

export default function (client: SherpaClient, self: typeof window) {
	// `element.attributes` returns the same live NamedNodeMap every time, and
	// the DOM guarantees `el.attributes === el.attributes`. Building a fresh
	// Proxy per read broke that identity (so a page caching the map compared
	// unequal against a later read) and allocated on every access, which is
	// hot on anything that walks attributes. One wrapper per map instead.
	const wrappers = new WeakMap<NamedNodeMap, NamedNodeMap>();

	client.Trap("Element.prototype.attributes", {
		get(ctx) {
			const map = ctx.get() as NamedNodeMap;
			const cached = wrappers.get(map);
			if (cached) return cached;

			const element = ctx.this as Element;
			const proxy = new Proxy(map, {
				get(target, prop, _receiver) {
					const value = Reflect.get(target, prop);

					if (prop === "length") {
						return Object.keys(proxy).length;
					}

					if (prop === "getNamedItem") {
						return (name: string) => {
							const attr = Reflect.apply(value, map, [name]) as Attr | null;

							return attr?.name?.startsWith(SHADOW_ATTRIBUTE_PREFIX)
								? null
								: attr;
						};
					}
					if (prop === "getNamedItemNS") {
						return (namespace: string | null, name: string) => {
							const attr = Reflect.apply(value, map, [
								namespace,
								name,
							]) as Attr | null;

							return attr?.name?.startsWith(SHADOW_ATTRIBUTE_PREFIX)
								? null
								: attr;
						};
					}
					if (prop === "setNamedItem") {
						return (attribute: Attr) => {
							if (attribute.name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
								return null;

							return element.setAttributeNode(attribute);
						};
					}
					if (prop === "setNamedItemNS") {
						return (attribute: Attr) => {
							if (attribute.name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
								return null;

							return element.setAttributeNodeNS(attribute);
						};
					}
					if (prop === "removeNamedItem") {
						return (name: string) => {
							if (String(name).startsWith(SHADOW_ATTRIBUTE_PREFIX)) {
								throw new self.DOMException(
									"The requested attribute does not exist",
									"NotFoundError"
								);
							}

							const attribute = Reflect.apply(value, map, [name]) as Attr;
							const originalValue = element.getAttribute(attribute.name);
							element.removeAttribute(attribute.name);
							if (originalValue !== null) {
								client.descriptors.set(
									"Attr.prototype.value",
									attribute,
									originalValue
								);
							}

							return attribute;
						};
					}
					if (prop === "removeNamedItemNS") {
						return (namespace: string | null, localName: string) => {
							if (String(localName).startsWith(SHADOW_ATTRIBUTE_PREFIX)) {
								throw new self.DOMException(
									"The requested attribute does not exist",
									"NotFoundError"
								);
							}

							const originalValue = element.getAttributeNS(
								namespace,
								localName
							);
							const attribute = Reflect.apply(value, map, [
								namespace,
								localName,
							]) as Attr;
							element.removeAttributeNS(namespace, localName);
							if (originalValue !== null) {
								client.descriptors.set(
									"Attr.prototype.value",
									attribute,
									originalValue
								);
							}

							return attribute;
						};
					}

					if (prop in NamedNodeMap.prototype && typeof value === "function") {
						return new Proxy(value, {
							apply(target, that, args) {
								if (that === proxy) {
									return Reflect.apply(target, map, args);
								}

								return Reflect.apply(target, that, args);
							},
						});
					}

					if (
						(typeof prop === "string" || typeof prop === "number") &&
						!isNaN(Number(prop))
					) {
						const position = Object.keys(proxy)[prop];

						return map[position];
					}

					if (!this.has(target, prop)) return undefined;

					return value;
				},
				ownKeys(target) {
					const keys = Reflect.ownKeys(target);

					return keys.filter((key) => this.has(target, key));
				},
				has(target, prop) {
					if (typeof prop === "symbol") return Reflect.has(target, prop);
					if (prop.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return false;
					if (map[prop]?.name?.startsWith(SHADOW_ATTRIBUTE_PREFIX))
						return false;

					return Reflect.has(target, prop);
				},
			});

			wrappers.set(map, proxy);

			return proxy;
		},
	});

	client.Trap(["Attr.prototype.value", "Attr.prototype.nodeValue"], {
		get(ctx) {
			if (ctx.this?.ownerElement) {
				return ctx.this.ownerElement.getAttribute(ctx.this.name);
			}

			return ctx.get();
		},
		set(ctx, value) {
			if (ctx.this?.ownerElement) {
				return ctx.this.ownerElement.setAttribute(ctx.this.name, value);
			}

			return ctx.set(value);
		},
	});
}
