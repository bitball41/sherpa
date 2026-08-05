import { SherpaClient } from "@client/index";
import { SHADOW_ATTRIBUTE_PREFIX } from "@rewriters/html";

/**
 * Array-index property name, per the spec's definition: canonical decimal
 * digits only. `!isNaN(Number(prop))` also accepted `""`, `" "`, `"1e3"` and
 * `"0x2"`, none of which are index properties on a `NamedNodeMap`.
 */
function isIndex(prop: string): boolean {
	if (prop.length === 0 || prop.length > 10) return false;
	for (let i = 0; i < prop.length; i++) {
		const c = prop.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}

	return prop.length === 1 || prop.charCodeAt(0) !== 48;
}

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

			// The page-visible view of the map hides Sherpa's `sherpa-attr-*`
			// entries, so both `length` and index access have to walk it. Doing
			// that with `Object.keys(proxy)` re-entered this proxy's own
			// `ownKeys`/`has` traps and materialized a key array for *every*
			// index read - so the ordinary `for (i = 0; i < attributes.length;
			// i++)` loop that analytics and framework code runs over an
			// element's attributes was quadratic, with an allocation per step.
			// Scanning the native map directly is the same answer without any
			// of that.
			const nativeItem = client.natives.store[
				"NamedNodeMap.prototype.item"
			] as typeof NamedNodeMap.prototype.item;
			const nativeLength = client.descriptors.store[
				"NamedNodeMap.prototype.length"
			] as PropertyDescriptor;

			function visibleAttribute(index: number): Attr | null {
				const total = nativeLength.get.call(map) as number;
				let seen = 0;
				for (let i = 0; i < total; i++) {
					const attr = nativeItem.call(map, i);
					if (attr === null) continue;
					if (attr.name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) continue;
					if (seen === index) return attr;
					seen++;
				}

				return null;
			}

			function visibleLength(): number {
				const total = nativeLength.get.call(map) as number;
				let visible = 0;
				for (let i = 0; i < total; i++) {
					const attr = nativeItem.call(map, i);
					if (attr !== null && !attr.name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
						visible++;
				}

				return visible;
			}

			const proxy = new Proxy(map, {
				get(target, prop, _receiver) {
					const value = Reflect.get(target, prop);

					if (prop === "length") {
						return visibleLength();
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

					// `Array.from(el.attributes)` / `[...el.attributes]` go through
					// the value iterator WebIDL gives an indexed-getter interface,
					// which is just `Array.prototype[Symbol.iterator]`. Rebinding it
					// to the raw map below made it walk the *unfiltered* attribute
					// list, so every `sherpa-attr-*` shadow attribute was handed
					// straight to the page. Left unwrapped it iterates the proxy's
					// own `length` and indices, which are filtered.
					if (prop === Symbol.iterator) return value;

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

					if (typeof prop === "string" && isIndex(prop)) {
						return visibleAttribute(Number(prop)) ?? undefined;
					}

					if (!this.has(target, prop)) return undefined;

					return value;
				},
				getOwnPropertyDescriptor(target, prop) {
					// Keep descriptor reads in step with the dense index view the
					// `get` trap presents; otherwise `Object.getOwnPropertyDescriptor
					// (attributes, "0")` could hand back a `sherpa-attr-*` node the
					// page is never supposed to see.
					if (typeof prop === "string" && isIndex(prop)) {
						const attr = visibleAttribute(Number(prop));
						if (!attr) return undefined;

						return {
							value: attr,
							writable: false,
							enumerable: true,
							configurable: true,
						};
					}

					if (!this.has(target, prop)) return undefined;

					return Reflect.getOwnPropertyDescriptor(target, prop);
				},
				ownKeys(target) {
					// Indices are renumbered densely so `length`, index access and
					// key enumeration agree. Filtering the target's own indices
					// left holes wherever a shadow attribute sat.
					const keys: (string | symbol)[] = [];
					const visible = visibleLength();
					for (let i = 0; i < visible; i++) keys.push(String(i));

					for (const key of Reflect.ownKeys(target)) {
						if (typeof key === "string" && isIndex(key)) continue;
						if (!this.has(target, key)) continue;
						keys.push(key);
					}

					return keys;
				},
				has(target, prop) {
					if (typeof prop === "symbol") return Reflect.has(target, prop);
					if (prop.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return false;
					if (isIndex(prop)) return visibleAttribute(Number(prop)) !== null;
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
