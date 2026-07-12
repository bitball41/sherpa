import { findHtmlRule } from "@/shared/htmlRules";
import { rewriteCss, unrewriteCss } from "@rewriters/css";
import { isEventAttribute, rewriteHtml, unrewriteHtml } from "@rewriters/html";
import { rewriteJs } from "@rewriters/js";
import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SHERPACLIENT } from "@/symbols";
import { SherpaClient } from "@client/index";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SHADOW_ATTRIBUTE_PREFIX = "sherpa-attr-";
function bytesToBase64(bytes: Uint8Array) {
	const binString = Array.from(bytes, (byte) =>
		String.fromCodePoint(byte)
	).join("");

	return btoa(binString);
}
function base64ToString(value: string): string {
	return decoder.decode(
		Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
	);
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

	for (const prop of attrs) {
		const attribute = propertyAttributes[prop] || prop;
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
					// These all reflect a single resolved (absolute) URL, so the
					// page-facing getter must unrewrite it back. `poster` (on
					// <video>) is rewritten by htmlRules just like the rest but was
					// missing here, so reading `video.poster` handed back the proxied
					// URL instead of the real one.
					if (
						["src", "data", "href", "action", "formAction", "poster"].includes(
							prop
						)
					) {
						return unrewriteUrl(descriptor.get.call(this));
					}
					const shadow = `${SHADOW_ATTRIBUTE_PREFIX}${attribute}`;
					if (
						client.natives.call("Element.prototype.hasAttribute", this, shadow)
					) {
						if (prop === "credentialless") return true;

						return client.natives.call(
							"Element.prototype.getAttribute",
							this,
							shadow
						);
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
			let base = node.ownerDocument?.querySelector("base");
			if (node instanceof Document) base = node.querySelector("base");

			if (base) {
				return new URL(base.href, client.url.href).href;
			}

			return client.url.href;
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

			if (
				client.natives.call(
					"Element.prototype.hasAttribute",
					ctx.this,
					`${SHADOW_ATTRIBUTE_PREFIX}${name}`
				)
			) {
				const attrib = ctx.fn.call(
					ctx.this,
					`${SHADOW_ATTRIBUTE_PREFIX}${name}`
				);
				if (attrib === null) return ctx.return("");

				return ctx.return(attrib);
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

	client.Proxy("Element.prototype.hasAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return ctx.return(false);
			if (
				client.natives.call(
					"Element.prototype.hasAttribute",
					ctx.this,
					`${SHADOW_ATTRIBUTE_PREFIX}${name}`
				)
			) {
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
			const value = String(ctx.args[1]);
			if (isEventAttribute(name)) {
				ctx.args[1] = rewriteJs(
					value,
					`(inline ${name} on element)`,
					client.meta
				);
				ctx.fn.call(ctx.this, `${SHADOW_ATTRIBUTE_PREFIX}${name}`, value);

				return;
			}

			const ruleList = findHtmlRule(name, ctx.this.tagName.toLowerCase());

			if (ruleList) {
				const ret = ruleList.fn(value, client.meta, client.cookieStore);
				if (ret == null) {
					ctx.fn.call(ctx.this, `${SHADOW_ATTRIBUTE_PREFIX}${name}`, value);
					client.natives.call(
						"Element.prototype.removeAttribute",
						ctx.this,
						name
					);
					ctx.return(undefined);

					return;
				}
				ctx.args[1] = ret;
				ctx.fn.call(ctx.this, `${SHADOW_ATTRIBUTE_PREFIX}${name}`, value);
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

	client.Proxy("Element.prototype.setAttributeNS", {
		apply(ctx) {
			const [namespace, rawName, rawValue] = ctx.args;
			const name = String(rawName);
			const value = String(rawValue);
			if (namespace == null && isEventAttribute(name)) {
				ctx.args[2] = rewriteJs(
					value,
					`(inline ${name} on element)`,
					client.meta
				);
				client.natives.call(
					"Element.prototype.setAttribute",
					ctx.this,
					`${SHADOW_ATTRIBUTE_PREFIX}${name}`,
					value
				);

				return;
			}

			const ruleList = findHtmlRule(name, ctx.this.tagName.toLowerCase());

			if (ruleList) {
				const rewritten = ruleList.fn(value, client.meta, client.cookieStore);
				client.natives.call(
					"Element.prototype.setAttribute",
					ctx.this,
					`${SHADOW_ATTRIBUTE_PREFIX}${name}`,
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
			ctx.fn.call(ctx.this, `${SHADOW_ATTRIBUTE_PREFIX}${name}`);
		},
	});

	client.Proxy("Element.prototype.toggleAttribute", {
		apply(ctx) {
			const name = String(ctx.args[0]);
			if (name.startsWith(SHADOW_ATTRIBUTE_PREFIX)) return ctx.return(false);
			const shadow = `${SHADOW_ATTRIBUTE_PREFIX}${name}`;
			const present =
				client.natives.call("Element.prototype.hasAttribute", ctx.this, name) ||
				client.natives.call("Element.prototype.hasAttribute", ctx.this, shadow);
			const shouldHave = ctx.args.length > 1 ? Boolean(ctx.args[1]) : !present;
			if (!shouldHave) {
				client.natives.call(
					"Element.prototype.removeAttribute",
					ctx.this,
					name
				);
				client.natives.call(
					"Element.prototype.removeAttribute",
					ctx.this,
					shadow
				);

				return ctx.return(false);
			}
			if (!present)
				self.Element.prototype.setAttribute.call(ctx.this, name, "");

			return ctx.return(true);
		},
	});

	client.Trap("Element.prototype.innerHTML", {
		set(ctx, value: string) {
			let newval;
			if (ctx.this instanceof self.HTMLScriptElement) {
				newval = rewriteJs(value, "(anonymous script element)", client.meta);
				client.natives.call(
					"Element.prototype.setAttribute",
					ctx.this,
					"sherpa-attr-script-source-src",
					bytesToBase64(encoder.encode(value))
				);
			} else if (ctx.this instanceof self.HTMLStyleElement) {
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
				const scriptSource = client.natives.call(
					"Element.prototype.getAttribute",
					ctx.this,
					"sherpa-attr-script-source-src"
				);

				if (scriptSource) {
					return base64ToString(scriptSource);
				}

				return ctx.get();
			}
			if (ctx.this instanceof self.HTMLStyleElement) {
				// the setter rewrites CSS through innerHTML, so the getter must
				// unrewrite it (mirrors the textContent trap below)
				return unrewriteCss(ctx.get() as string);
			}

			return unrewriteHtml(ctx.get());
		},
	});

	client.Trap("Node.prototype.textContent", {
		set(ctx, value: string) {
			// TODO: box the instanceofs
			if (ctx.this instanceof self.HTMLScriptElement) {
				const newval: string = rewriteJs(
					value,
					"(anonymous script element)",
					client.meta
				) as string;
				client.natives.call(
					"Element.prototype.setAttribute",
					ctx.this,
					"sherpa-attr-script-source-src",
					bytesToBase64(encoder.encode(value))
				);

				return ctx.set(newval);
			} else if (ctx.this instanceof self.HTMLStyleElement) {
				return ctx.set(rewriteCss(value, client.meta));
			} else {
				return ctx.set(value);
			}
		},
		get(ctx) {
			if (ctx.this instanceof self.HTMLScriptElement) {
				const scriptSource = client.natives.call(
					"Element.prototype.getAttribute",
					ctx.this,
					"sherpa-attr-script-source-src"
				);

				if (scriptSource) {
					return base64ToString(scriptSource);
				}

				return ctx.get();
			}
			if (ctx.this instanceof self.HTMLStyleElement) {
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

	client.Proxy("Element.prototype.setHTMLUnsafe", {
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
	});

	client.Proxy("Element.prototype.getHTML", {
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
	client.Proxy("Text.prototype.appendData", {
		apply(ctx) {
			if (ctx.this.parentElement?.tagName === "STYLE") {
				ctx.args[0] = rewriteCss(ctx.args[0], client.meta);
			}
		},
	});

	client.Proxy("Text.prototype.insertData", {
		apply(ctx) {
			if (ctx.this.parentElement?.tagName === "STYLE") {
				ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
			}
		},
	});

	client.Proxy("Text.prototype.replaceData", {
		apply(ctx) {
			if (ctx.this.parentElement?.tagName === "STYLE") {
				ctx.args[2] = rewriteCss(ctx.args[2], client.meta);
			}
		},
	});

	client.Trap("Text.prototype.wholeText", {
		get(ctx) {
			if (ctx.this.parentElement?.tagName === "STYLE") {
				return unrewriteCss(ctx.get() as string);
			}

			return ctx.get();
		},
		set(ctx, v) {
			if (ctx.this.parentElement?.tagName === "STYLE") {
				return ctx.set(rewriteCss(v as string, client.meta));
			}

			return ctx.set(v);
		},
	});

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
