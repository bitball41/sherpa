import { findHtmlRule } from "@/shared/htmlRules";
import { isCssStyleType, rewriteCss, unrewriteCss } from "@rewriters/css";
import {
	isEventAttribute,
	rewriteHtml,
	SCRIPT_SOURCE_ATTRIBUTE,
	SHADOW_ATTRIBUTE_PREFIX,
	unrewriteHtml,
} from "@rewriters/html";
import { rewriteJs } from "@rewriters/js";
import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SHERPACLIENT } from "@/symbols";
import { SherpaClient } from "@client/index";
import { base64ToBytes, bytesToBase64 } from "@/shared/base64";
import { resolveBaseHref } from "@/shared/urlCodec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// Reflected properties that resolve to a single absolute URL, so their
// page-facing getter has to hand back the unrewritten one. Membership is
// fixed, so it is resolved when the trap is installed rather than on every
// property read.
const URL_VALUED_PROPERTIES = new Set([
	"src",
	"data",
	"href",
	"action",
	"formAction",
	"poster",
]);
function base64ToString(value: string): string {
	return decoder.decode(base64ToBytes(value));
}
export default function (client: SherpaClient, self: typeof window) {
	const attrObject = {
		nonce: [self.HTMLElement],
		integrity: [self.HTMLScriptElement, self.HTMLLinkElement],
		csp: [self.HTMLIFrameElement],
		credentialless: [self.HTMLIFrameElement],
		src: [
			self.HTMLImageElement,
			self.HTMLMediaElement,
			self.HTMLIFrameElement,
			self.HTMLFrameElement,
			self.HTMLEmbedElement,
			self.HTMLScriptElement,
			self.HTMLSourceElement,
			// htmlRules rewrites src on <input type=image> and <track>, so their
			// reflected .src getters must unrewrite it back too.
			self.HTMLInputElement,
			self.HTMLTrackElement,
		],
		// <area href> reflects a resolved URL just like <a>/<link>; without it
		// areaElement.href hands the page back the proxied URL.
		href: [self.HTMLAnchorElement, self.HTMLLinkElement, self.HTMLAreaElement],
		data: [self.HTMLObjectElement],
		action: [self.HTMLFormElement],
		formAction: [self.HTMLButtonElement, self.HTMLInputElement],
		srcdoc: [self.HTMLIFrameElement],
		poster: [self.HTMLVideoElement],
		imageSrcset: [self.HTMLLinkElement],
		srcset: [self.HTMLImageElement, self.HTMLSourceElement],
		// `<body background>` reflects the content attribute verbatim (no URL
		// resolution), so the page has to be handed the value it authored
		// rather than the rewritten one htmlRules put in the attribute.
		background: [self.HTMLBodyElement],
		// `ping` reflects verbatim too - it is a URL list, not a single URL.
		ping: [self.HTMLAnchorElement, self.HTMLAreaElement],
	};
	const propertyAttributes = {
		formAction: "formaction",
		imageSrcset: "imagesrcset",
	};

	const urlinterfaces = [
		self.HTMLAnchorElement.prototype,
		self.HTMLAreaElement.prototype,
	];
	const originalhrefs = [
		client.natives.call(
			"Object.getOwnPropertyDescriptor",
			null,
			self.HTMLAnchorElement.prototype,
			"href"
		),
		client.natives.call(
			"Object.getOwnPropertyDescriptor",
			null,
			self.HTMLAreaElement.prototype,
			"href"
		),
	];

	const attrs = Object.keys(attrObject);

	// SVG carries its own `<style>` interface, so "is this element a stylesheet"
	// can't be a single `instanceof HTMLStyleElement`. An `<svg><style>` whose
	// text was assigned through `innerHTML`/`textContent` was run through the
	// *HTML* rewriter instead of the CSS one.
	const isStyleElement = (node: unknown): boolean =>
		(node instanceof self.HTMLStyleElement ||
			(self.SVGStyleElement !== undefined &&
				node instanceof self.SVGStyleElement)) &&
		// ...and only when its `type` makes the browser parse it as CSS
		isCssStyleType((node as HTMLStyleElement).type);

	// Captured before the traps below replace them. Every attribute getter,
	// setter and shadow-attribute probe goes through these, so resolving them
	// once beats re-entering `natives.store`'s Proxy (and its rest-argument
	// array) on every DOM attribute operation a page performs.
	const nativeHasAttribute = client.natives.store[
		"Element.prototype.hasAttribute"
	] as typeof Element.prototype.hasAttribute;
	const nativeGetAttribute = client.natives.store[
		"Element.prototype.getAttribute"
	] as typeof Element.prototype.getAttribute;
	const nativeSetAttribute = client.natives.store[
		"Element.prototype.setAttribute"
	] as typeof Element.prototype.setAttribute;
	const nativeRemoveAttribute = client.natives.store[
		"Element.prototype.removeAttribute"
	] as typeof Element.prototype.removeAttribute;

	function namespacedShadowAttribute(
		element: Element,
		namespace: string | null,
		localName: string
	): string {
		const attribute = client.natives.call(
			"Element.prototype.getAttributeNodeNS",
			element,
			namespace,
			localName
		) as Attr | null;
		const qualifiedName = attribute
			? client.descriptors.get("Attr.prototype.name", attribute)
			: localName;

		return `${SHADOW_ATTRIBUTE_PREFIX}${qualifiedName || localName}`;
	}

	for (const prop of attrs) {
		const attribute = propertyAttributes[prop] || prop;
		// These all reflect a single resolved (absolute) URL, so the page-facing
		// getter must unrewrite it back. `poster` (on <video>) is rewritten by
		// htmlRules just like the rest but was missing here, so reading
		// `video.poster` handed back the proxied URL instead of the real one.
		const isUrlValued = URL_VALUED_PROPERTIES.has(prop);
		const shadow = `${SHADOW_ATTRIBUTE_PREFIX}${attribute}`;
		const isCredentialless = prop === "credentialless";
		for (const element of attrObject[prop]) {
			// A constructor may be absent (older engines) or not carry the attr;
			// skip rather than throwing from the getter later and breaking hook().
			if (!element) continue;
			const descriptor = client.natives.call(
				"Object.getOwnPropertyDescriptor",
				null,
				element.prototype,
				prop
			);
			if (!descriptor?.get) continue;
			Object.defineProperty(element.prototype, prop, {
				get() {
					if (isUrlValued) {
						return unrewriteUrl(descriptor.get.call(this));
					}
					if (nativeHasAttribute.call(this, shadow)) {
						if (isCredentialless) return true;

						return nativeGetAttribute.call(this, shadow);
					}

					return descriptor.get.call(this);
				},

				set(value) {
					return this.setAttribute(attribute, value);
				},
			});
		}
	}

	// note that href is not here
	const urlprops = [
		"protocol",
		"hash",
		"host",
		"hostname",
		"origin",
		"pathname",
		"port",
		"search",
	];
	for (const prop of urlprops) {
		for (const i in urlinterfaces) {
			const target = urlinterfaces[i];
			const desc = originalhrefs[i];
			client.RawTrap(target, prop, {
				get(ctx) {
					const href = desc.get.call(ctx.this);
					if (!href) return href;

					const url = new URL(unrewriteUrl(href));

					return url[prop];
				},
			});
		}
	}

	client.Trap("Node.prototype.baseURI", {
		get(ctx) {
			const node = ctx.this as Node;
			const document =
				node instanceof Document ? node : (node.ownerDocument ?? null);
			const base = document
				? (
						client.natives.call(
							"Document.prototype.getElementsByTagName",
							document,
							"base"
						) as HTMLCollectionOf<Element>
					)[0]
				: undefined;

			if (base) {
				// `base.href` is the *reflected* property, which the browser has
				// already resolved against the document's URL - and the proxied
				// document's URL is on the proxy origin. Reading it here handed
				// the page a `baseURI` pointing at Sherpa's own host, so any
				// `new URL(path, document.baseURI)` the site did built a
				// proxy-origin URL. Resolve the authored attribute against the
				// real document URL instead, exactly as `client.meta.base` does.
				const shadow = SHADOW_ATTRIBUTE_PREFIX + "href";
				const raw = nativeHasAttribute.call(base, shadow)
					? nativeGetAttribute.call(base, shadow)
					: nativeGetAttribute.call(base, "href");

				if (raw) {
					const frag = raw.indexOf("#");
					const href = raw.substring(0, frag === -1 ? undefined : frag);
					if (href)
						return (
							resolveBaseHref(href, client.fallbackBase) ?? client.fallbackBase
						).href;
				}
			}

			return client.fallbackBase.href;
		},
		set(_ctx, _v) {
			return false;
		},
	});

	client.Proxy("Element.prototype.getAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);

			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) {
				return ctx.return(null);
			}

			const shadow = SHADOW_ATTRIBUTE_PREFIX + name;
			if (nativeHasAttribute.call(ctx.this, shadow)) {
				const attrib = ctx.fn.call(ctx.this, shadow);
				if (attrib === null) return ctx.return("");

				return ctx.return(attrib);
			}
		},
	});

	client.Proxy("Element.prototype.getAttributeNS", {
		apply(ctx) {
			const namespace = ctx.args[0] == null ? null : String(ctx.args[0]);
			const localName = String(ctx.args[1]);
			if (localName.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(null);

			const shadow = namespacedShadowAttribute(ctx.this, namespace, localName);
			if (nativeHasAttribute.call(ctx.this, shadow)) {
				const value = nativeGetAttribute.call(ctx.this, shadow);

				return ctx.return(value ?? "");
			}
		},
	});

	client.Proxy("Element.prototype.getAttributeNames", {
		apply(ctx) {
			const attrNames = ctx.call() as string[];
			const cleaned = attrNames.filter(
				(attr) => !attr.startsWith(SHADOW_ATTRIBUTE_PREFIX)
			);

			ctx.return(cleaned);
		},
	});

	client.Proxy("Element.prototype.getAttributeNode", {
		apply(ctx) {
			if (String(ctx.args[0]).startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(null);
		},
	});

	client.Proxy("Element.prototype.getAttributeNodeNS", {
		apply(ctx) {
			if (String(ctx.args[1]).startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(null);
		},
	});

	client.Proxy("Element.prototype.hasAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return ctx.return(false);
			if (nativeHasAttribute.call(ctx.this, SHADOW_ATTRIBUTE_PREFIX + name)) {
				return ctx.return(true);
			}
		},
	});

	client.Proxy("Element.prototype.hasAttributeNS", {
		apply(ctx) {
			const namespace = ctx.args[0] == null ? null : String(ctx.args[0]);
			const localName = String(ctx.args[1]);
			if (localName.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(false);

			const shadow = namespacedShadowAttribute(ctx.this, namespace, localName);
			if (nativeHasAttribute.call(ctx.this, shadow)) {
				return ctx.return(true);
			}
		},
	});

	client.Proxy("Element.prototype.setAttribute", {
		apply(ctx) {
			const rawName = String(ctx.args[0]);
			const name =
				ctx.this.namespaceURI === "http://www.w3.org/1999/xhtml"
					? rawName.toLowerCase()
					: rawName;
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(undefined);
			const value = String(ctx.args[1]);
			if (isEventAttribute(name)) {
				ctx.args[1] = rewriteJs(
					value,
					`(inline ${name} on element)`,
					client.meta
				);
				ctx.fn.call(ctx.this, SHADOW_ATTRIBUTE_PREFIX + name, value);

				return;
			}

			const ruleList = findHtmlRule(name, ctx.this.tagName.toLowerCase());

			if (ruleList) {
				const ret = ruleList.fn(value, client.meta, client.cookieStore);
				if (ret == null) {
					ctx.fn.call(ctx.this, SHADOW_ATTRIBUTE_PREFIX + name, value);
					nativeRemoveAttribute.call(ctx.this, name);
					ctx.return(undefined);

					return;
				}
				ctx.args[1] = ret;
				ctx.fn.call(ctx.this, SHADOW_ATTRIBUTE_PREFIX + name, value);
			}
		},
	});

	client.Proxy("Element.prototype.setAttributeNode", {
		apply(ctx) {
			const attribute = ctx.args[0] as Attr;
			const ownerElement = client.descriptors.get(
				"Attr.prototype.ownerElement",
				attribute
			);

			// Let the native implementation handle attributes that are already in
			// use, including returning early or throwing InUseAttributeError.
			if (ownerElement) return ctx.call();

			const name = client.descriptors.get("Attr.prototype.name", attribute);
			if (String(name).startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(null);
			const value = client.descriptors.get("Attr.prototype.value", attribute);
			const previousValue = self.Element.prototype.getAttribute.call(
				ctx.this,
				name
			);
			const previousAttribute = ctx.call() as Attr | null;

			// setAttributeNode detaches and returns the replaced Attr. Once detached,
			// its trapped value getter can no longer recover the original value from
			// Sherpa's hidden attribute, so restore that value on the returned node.
			if (previousAttribute && previousValue !== null) {
				client.descriptors.set(
					"Attr.prototype.value",
					previousAttribute,
					previousValue
				);
			}

			// The native call preserves the supplied Attr node's identity. Updating
			// it through the regular trap then applies URL/CSS/srcdoc rewriting and
			// records the original value for the page-facing attribute APIs.
			self.Element.prototype.setAttribute.call(ctx.this, name, value);
			ctx.return(previousAttribute);
		},
	});

	client.Proxy("Element.prototype.setAttributeNodeNS", {
		apply(ctx) {
			const attribute = ctx.args[0] as Attr;
			const ownerElement = client.descriptors.get(
				"Attr.prototype.ownerElement",
				attribute
			);
			if (ownerElement) return ctx.call();

			const name = client.descriptors.get("Attr.prototype.name", attribute);
			if (String(name).startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(null);
			const namespace = client.descriptors.get(
				"Attr.prototype.namespaceURI",
				attribute
			);
			const localName = client.descriptors.get(
				"Attr.prototype.localName",
				attribute
			);
			const value = client.descriptors.get("Attr.prototype.value", attribute);
			const previousValue = self.Element.prototype.getAttributeNS.call(
				ctx.this,
				namespace,
				localName
			);
			const previousAttribute = ctx.call() as Attr | null;

			if (previousAttribute && previousValue !== null) {
				client.descriptors.set(
					"Attr.prototype.value",
					previousAttribute,
					previousValue
				);
			}

			self.Element.prototype.setAttributeNS.call(
				ctx.this,
				namespace,
				name,
				value
			);
			ctx.return(previousAttribute);
		},
	});

	client.Proxy("Element.prototype.setAttributeNS", {
		apply(ctx) {
			const [namespace, rawName, rawValue] = ctx.args;
			const name = String(rawName);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(undefined);
			const value = String(rawValue);
			const eventAttribute = namespace == null && isEventAttribute(name);
			const ruleList = findHtmlRule(name, ctx.this.tagName.toLowerCase());
			if (eventAttribute || ruleList) {
				// Validate namespace/qualified-name combinations before creating the
				// shadow value. Otherwise a native NamespaceError would leave stale
				// internal state behind.
				self.document.createAttributeNS(namespace, name);
			}
			if (eventAttribute) {
				ctx.args[2] = rewriteJs(
					value,
					`(inline ${name} on element)`,
					client.meta
				);
				nativeSetAttribute.call(
					ctx.this,
					SHADOW_ATTRIBUTE_PREFIX + name,
					value
				);

				return;
			}

			if (ruleList) {
				const rewritten = ruleList.fn(value, client.meta, client.cookieStore);
				nativeSetAttribute.call(
					ctx.this,
					SHADOW_ATTRIBUTE_PREFIX + name,
					value
				);
				if (rewritten == null) {
					client.natives.call(
						"Element.prototype.removeAttributeNS",
						ctx.this,
						ctx.args[0],
						name
					);

					return ctx.return(undefined);
				}
				ctx.args[2] = rewritten;
			}
		},
	});

	// `HTMLHyperlinkElementUtils` gives `<a>` and `<area>` a stringifier, and
	// it is a *separate* method from the `href` getter - so while `a.href`
	// unrewrote correctly, `String(a)`, `a + ""`, `` `${a}` `` and
	// `new URL(a)` all handed the page Sherpa's proxied URL. Sites build URLs
	// out of link elements that way constantly.
	client.Proxy(
		["HTMLAnchorElement.prototype.toString", "HTMLAreaElement.prototype.toString"],
		{
			apply(ctx) {
				ctx.return(unrewriteUrl(ctx.call() as string));
			},
		}
	);

	// this is separate from the regular href handlers because it returns an SVGAnimatedString
	client.Trap("SVGAnimatedString.prototype.baseVal", {
		get(ctx) {
			const href = ctx.get() as string;
			if (!href) return href;

			return unrewriteUrl(href);
		},
		set(ctx, val: string) {
			ctx.set(rewriteUrl(val, client.meta));
		},
	});
	client.Trap("SVGAnimatedString.prototype.animVal", {
		get(ctx) {
			const href = ctx.get() as string;
			if (!href) return href;

			return unrewriteUrl(href);
		},
		// it has no setter
	});

	client.Proxy("Element.prototype.removeAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(undefined);
			ctx.fn.call(ctx.this, SHADOW_ATTRIBUTE_PREFIX + name);
		},
	});

	client.Proxy("Element.prototype.removeAttributeNS", {
		apply(ctx) {
			const namespace = ctx.args[0] == null ? null : String(ctx.args[0]);
			const localName = String(ctx.args[1]);
			if (localName.startsWith(SHADOW_ATTRIBUTE_PREFIX))
				return ctx.return(undefined);
			const shadow = namespacedShadowAttribute(ctx.this, namespace, localName);
			const result = ctx.call();
			nativeRemoveAttribute.call(ctx.this, shadow);

			ctx.return(result);
		},
	});

	client.Proxy("Element.prototype.toggleAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return ctx.return(false);
			const shadow = SHADOW_ATTRIBUTE_PREFIX + name;
			const present =
				nativeHasAttribute.call(ctx.this, name) ||
				nativeHasAttribute.call(ctx.this, shadow);
			// An explicit `undefined` counts as "not supplied", per WebIDL's
			// optional-argument conversion - `Boolean(undefined)` would have made
			// `toggleAttribute(name, undefined)` always remove.
			const force = ctx.args.length > 1 ? ctx.args[1] : undefined;
			const shouldHave = force === undefined ? !present : Boolean(force);
			if (!shouldHave) {
				nativeRemoveAttribute.call(ctx.this, name);
				nativeRemoveAttribute.call(ctx.this, shadow);

				return ctx.return(false);
			}
			if (!present)
				self.Element.prototype.setAttribute.call(ctx.this, name, "");

			return ctx.return(true);
		},
	});

	// `innerHTML` is not one property: the `InnerHTML` mixin is implemented by
	// `Element` *and* by `ShadowRoot`, each with its own accessor. Trapping only
	// the `Element` one left every shadow root - the entire web-components half
	// of the platform - writing markup straight past the rewriter, so a custom
	// element's `shadowRoot.innerHTML = "<img src=/logo.png>"` fetched from the
	// proxy's own origin instead of the site's.
	client.Trap(
		["Element.prototype.innerHTML", "ShadowRoot.prototype.innerHTML"],
		{
			set(ctx, value: string) {
				let newval;
				if (ctx.this instanceof self.HTMLScriptElement) {
					newval = rewriteJs(value, "(anonymous script element)", client.meta);
					nativeSetAttribute.call(
						ctx.this,
						SCRIPT_SOURCE_ATTRIBUTE,
						bytesToBase64(encoder.encode(value))
					);
				} else if (isStyleElement(ctx.this)) {
					newval = rewriteCss(value, client.meta);
				} else {
					try {
						newval = rewriteHtml(value, client.cookieStore, client.meta);
					} catch {
						newval = value;
					}
				}

				ctx.set(newval);
			},
			get(ctx) {
				if (ctx.this instanceof self.HTMLScriptElement) {
					const scriptSource = nativeGetAttribute.call(
						ctx.this,
						SCRIPT_SOURCE_ATTRIBUTE
					);

					if (scriptSource) {
						return base64ToString(scriptSource);
					}

					return ctx.get();
				}
				if (isStyleElement(ctx.this)) {
					// the setter rewrites CSS through innerHTML, so the getter must
					// unrewrite it (mirrors the textContent trap below)
					return unrewriteCss(ctx.get() as string);
				}

				return unrewriteHtml(ctx.get());
			},
		}
	);

	client.Trap("Node.prototype.textContent", {
		set(ctx, value: string) {
			// TODO: box the instanceofs
			if (ctx.this instanceof self.HTMLScriptElement) {
				const newval: string = rewriteJs(
					value,
					"(anonymous script element)",
					client.meta
				) as string;
				nativeSetAttribute.call(
					ctx.this,
					SCRIPT_SOURCE_ATTRIBUTE,
					bytesToBase64(encoder.encode(value))
				);

				return ctx.set(newval);
			} else if (isStyleElement(ctx.this)) {
				return ctx.set(rewriteCss(value, client.meta));
			} else {
				return ctx.set(value);
			}
		},
		get(ctx) {
			if (ctx.this instanceof self.HTMLScriptElement) {
				const scriptSource = nativeGetAttribute.call(
					ctx.this,
					SCRIPT_SOURCE_ATTRIBUTE
				);

				if (scriptSource) {
					return base64ToString(scriptSource);
				}

				return ctx.get();
			}
			if (isStyleElement(ctx.this)) {
				return unrewriteCss(ctx.get() as string);
			}

			return ctx.get();
		},
	});

	client.Trap("Element.prototype.outerHTML", {
		set(ctx, value: string) {
			ctx.set(rewriteHtml(value, client.cookieStore, client.meta));
		},
		get(ctx) {
			return unrewriteHtml(ctx.get());
		},
	});

	// Same mixin, same reason as `innerHTML` above: `ShadowRoot` carries its own
	// copies of these, so a shadow root's markup has to be intercepted there too.
	client.Proxy(
		["Element.prototype.setHTMLUnsafe", "ShadowRoot.prototype.setHTMLUnsafe"],
		{
			apply(ctx) {
				try {
					ctx.args[0] = rewriteHtml(
						ctx.args[0],
						client.cookieStore,
						client.meta,
						false
					);
				} catch {}
			},
		}
	);

	client.Proxy(["Element.prototype.getHTML", "ShadowRoot.prototype.getHTML"], {
		apply(ctx) {
			ctx.return(unrewriteHtml(ctx.call()));
		},
	});

	client.Proxy("Element.prototype.insertAdjacentHTML", {
		apply(ctx) {
			if (ctx.args[1])
				try {
					ctx.args[1] = rewriteHtml(
						ctx.args[1],
						client.cookieStore,
						client.meta,
						false
					);
				} catch {}
		},
	});
	client.Proxy("Audio", {
		construct(ctx) {
			if (ctx.args[0]) ctx.args[0] = rewriteUrl(ctx.args[0], client.meta);
		},
	});
	// The `<style>` text traps that used to live here (`appendData`,
	// `insertData`, `replaceData`, `wholeText`) moved to `dom/css.ts`, next to
	// the rest of the stylesheet interception and the node-insertion paths they
	// were missing - one predicate for "is this text a stylesheet" instead of
	// two that had already drifted apart.

	client.Trap(
		[
			"HTMLIFrameElement.prototype.contentWindow",
			"HTMLFrameElement.prototype.contentWindow",
			"HTMLObjectElement.prototype.contentWindow",
			"HTMLEmbedElement.prototype.contentWindow",
		],
		{
			get(ctx) {
				const realwin = ctx.get() as Window;
				if (!realwin) return realwin;

				if (!(SHERPACLIENT in realwin)) {
					// hook the iframe before the client can start to steal globals out of it
					const newclient = new SherpaClient(realwin);
					newclient.hook();
				}

				return realwin;
			},
		}
	);

	client.Trap(
		[
			"HTMLIFrameElement.prototype.contentDocument",
			"HTMLFrameElement.prototype.contentDocument",
			"HTMLObjectElement.prototype.contentDocument",
			"HTMLEmbedElement.prototype.contentDocument",
		],
		{
			get(ctx) {
				const realwin = client.descriptors.get(
					`${ctx.this.constructor.name}.prototype.contentWindow`,
					ctx.this
				);
				if (!realwin) return realwin;

				if (!(SHERPACLIENT in realwin)) {
					const newclient = new SherpaClient(realwin);
					newclient.hook();
				}

				return realwin.document;
			},
		}
	);

	client.Proxy(
		[
			"HTMLIFrameElement.prototype.getSVGDocument",
			"HTMLObjectElement.prototype.getSVGDocument",
			"HTMLEmbedElement.prototype.getSVGDocument",
		],
		{
			apply(ctx) {
				const doc = ctx.call();
				if (doc) {
					// we trap the contentDocument, this is really the sherpa version
					return ctx.return(ctx.this.contentDocument);
				}
			},
		}
	);

	client.Proxy("DOMParser.prototype.parseFromString", {
		apply(ctx) {
			if (ctx.args[1] === "text/html") {
				try {
					ctx.args[0] = rewriteHtml(
						ctx.args[0],
						client.cookieStore,
						client.meta,
						false
					);
				} catch {}
			}
		},
	});
}
