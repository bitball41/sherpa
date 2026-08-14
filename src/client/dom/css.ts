import { isCssStyleType, rewriteCss, unrewriteCss } from "@rewriters/css";
import { SherpaClient } from "@client/index";

/** Node types this module has to look at, spelled out to avoid `Node.*` reads. */
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const DOCUMENT_FRAGMENT_NODE = 11;

export default function (client: SherpaClient, self: typeof window) {
	// A `<style>` element's text *is* its stylesheet, so every path that can
	// write that text has to run through `rewriteCss`. `textContent` and
	// `innerHTML` were covered; nothing else was, and the uncovered paths are
	// the ones CSS-in-JS actually uses - `style.appendChild(document
	// .createTextNode(css))` is how Emotion, JSS and styled-components inject
	// rules outside their fast (`insertRule`) mode, and it is the oldest
	// hand-rolled idiom there is. Any `url()` in that CSS stayed relative, so
	// the browser resolved it against the *proxy's* origin and every background
	// image, font and mask in it 404'd.
	//
	// The interception is installed on the style elements' own prototypes
	// rather than on `Node.prototype`/`Element.prototype`, so `appendChild` and
	// friends stay completely untrapped for every other element on the page -
	// this costs nothing on the hottest DOM methods there are.
	const styleTextData = (
		self.CharacterData
			? client.natives.call(
					"Object.getOwnPropertyDescriptor",
					null,
					self.CharacterData.prototype,
					"data"
				)
			: undefined
	) as PropertyDescriptor | undefined;

	// SVG's `<style>` is `SVGStyleElement`, a different interface with the same
	// meaning, so both are covered. `localName` rather than `tagName` for the
	// same reason: an SVG style element's `tagName` is lowercase.
	function isStyleElement(node: any): boolean {
		return (
			node != null && node.localName === "style" && isCssStyleType(node.type)
		);
	}

	/** True for a character-data node whose text is a stylesheet. */
	function isStyleText(node: any): boolean {
		return node != null && isStyleElement(node.parentNode);
	}

	function readTextData(node: any): string {
		return styleTextData ? styleTextData.get.call(node) : node.data;
	}

	function writeTextData(node: any, value: string): void {
		// Deliberately the native setter: the `data` trap below would rewrite
		// again (harmless, `rewriteCss` is idempotent) and re-read the parent
		// for nothing.
		if (styleTextData) styleTextData.set.call(node, value);
		else node.data = value;
	}

	/**
	 * Rewrites CSS about to be inserted into a `<style>`. Strings become text
	 * nodes, text nodes are rewritten in place, and a fragment is walked
	 * because that is how a template's contents arrive.
	 */
	function rewriteInsertion(value: any): any {
		if (typeof value === "string") return rewriteCss(value, client.meta);
		if (value === null || typeof value !== "object") return value;

		const type = value.nodeType;
		if (type === TEXT_NODE || type === CDATA_SECTION_NODE) {
			const data = readTextData(value);
			if (data) writeTextData(value, rewriteCss(data, client.meta));
		} else if (type === DOCUMENT_FRAGMENT_NODE) {
			for (let child = value.firstChild; child; child = child.nextSibling)
				rewriteInsertion(child);
		}

		return value;
	}

	function rewriteInsertedArgs(args: any[], from: number, to: number): void {
		for (let i = from; i < to; i++) args[i] = rewriteInsertion(args[i]);
	}

	for (const proto of [
		self.HTMLStyleElement?.prototype,
		self.SVGStyleElement?.prototype,
	]) {
		if (!proto) continue;

		// `appendChild`/`insertBefore`/`replaceChild` take the new node first;
		// `append`/`prepend`/`replaceChildren` take any number of nodes or
		// strings.
		client.RawProxy(proto, "appendChild", {
			apply: (ctx) => rewriteInsertedArgs(ctx.args, 0, 1),
		});
		client.RawProxy(proto, "insertBefore", {
			apply: (ctx) => rewriteInsertedArgs(ctx.args, 0, 1),
		});
		client.RawProxy(proto, "replaceChild", {
			apply: (ctx) => rewriteInsertedArgs(ctx.args, 0, 1),
		});
		for (const method of ["append", "prepend", "replaceChildren"]) {
			client.RawProxy(proto, method, {
				apply: (ctx) => rewriteInsertedArgs(ctx.args, 0, ctx.args.length),
			});
		}
		client.RawProxy(proto, "insertAdjacentText", {
			apply(ctx) {
				// `beforebegin`/`afterend` land outside the element, where the
				// text is not CSS at all.
				const where = String(ctx.args[0]).toLowerCase();
				if (where === "afterbegin" || where === "beforeend")
					ctx.args[1] = rewriteInsertion(ctx.args[1]);
			},
		});
	}

	// Writing through the text node itself, once it is already inside the
	// `<style>`: the same stylesheet source by another name.
	client.Trap("CharacterData.prototype.data", {
		get(ctx) {
			const value = ctx.get() as string;
			if (!value || !isStyleText(ctx.this)) return value;

			return unrewriteCss(value);
		},
		set(ctx, value: string) {
			if (!isStyleText(ctx.this)) return ctx.set(value);

			ctx.set(rewriteCss(String(value), client.meta));
		},
	});

	// `Attr.prototype.nodeValue` has its own trap, and it wins for attributes
	// because `Attr.prototype` is further down the chain than `Node.prototype`.
	client.Trap("Node.prototype.nodeValue", {
		get(ctx) {
			const value = ctx.get() as string;
			if (!value || !isStyleText(ctx.this)) return value;

			return unrewriteCss(value);
		},
		set(ctx, value: string) {
			if (value == null || !isStyleText(ctx.this)) return ctx.set(value);

			ctx.set(rewriteCss(String(value), client.meta));
		},
	});

	client.Proxy("Text.prototype.appendData", {
		apply(ctx) {
			if (isStyleText(ctx.this))
				ctx.args[0] = rewriteCss(ctx.args[0], client.meta);
		},
	});

	client.Proxy("Text.prototype.insertData", {
		apply(ctx) {
			if (isStyleText(ctx.this))
				ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
		},
	});

	client.Proxy("Text.prototype.replaceData", {
		apply(ctx) {
			if (isStyleText(ctx.this))
				ctx.args[2] = rewriteCss(ctx.args[2], client.meta);
		},
	});

	client.Trap("Text.prototype.wholeText", {
		get(ctx) {
			if (isStyleText(ctx.this)) return unrewriteCss(ctx.get() as string);

			return ctx.get();
		},
		// `wholeText` is read-only in the DOM. Installing a setter for it turned
		// what the platform makes a silent no-op (or a strict-mode TypeError
		// raised by the page's own assignment) into a throw from inside Sherpa,
		// because the native descriptor it delegated to has no setter at all.
	});

	client.Proxy("CSSStyleDeclaration.prototype.setProperty", {
		apply(ctx) {
			if (!ctx.args[1]) return;
			ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
		},
	});

	client.Proxy("CSSStyleDeclaration.prototype.getPropertyValue", {
		apply(ctx) {
			const v = ctx.call();
			if (!v) return v;
			ctx.return(unrewriteCss(v));
		},
	});

	client.Trap("CSSStyleDeclaration.prototype.cssText", {
		set(ctx, value: string) {
			ctx.set(rewriteCss(value, client.meta));
		},
		get(ctx) {
			return unrewriteCss(ctx.get());
		},
	});

	// `CSSGroupingRule` is where `@media`/`@supports`/`@layer` blocks get their
	// nested rules; trapping only the sheet's own `insertRule` missed every
	// rule a page added inside a media query.
	client.Proxy(
		[
			"CSSStyleSheet.prototype.insertRule",
			"CSSGroupingRule.prototype.insertRule",
		],
		{
			apply(ctx) {
				ctx.args[0] = rewriteCss(ctx.args[0], client.meta);
			},
		}
	);

	// The legacy IE-era pair, still implemented by every engine: `addRule` takes
	// the declaration block as its second argument.
	client.Proxy("CSSStyleSheet.prototype.addRule", {
		apply(ctx) {
			if (ctx.args[1]) ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
		},
	});

	client.Proxy("CSSStyleSheet.prototype.replace", {
		apply(ctx) {
			ctx.args[0] = rewriteCss(ctx.args[0], client.meta);
		},
	});

	client.Proxy("CSSStyleSheet.prototype.replaceSync", {
		apply(ctx) {
			ctx.args[0] = rewriteCss(ctx.args[0], client.meta);
		},
	});

	client.Trap("CSSRule.prototype.cssText", {
		set(ctx, value: string) {
			ctx.set(rewriteCss(value, client.meta));
		},
		get(ctx) {
			return unrewriteCss(ctx.get());
		},
	});

	client.Proxy("CSSStyleValue.parse", {
		apply(ctx) {
			if (!ctx.args[1]) return;
			ctx.args[1] = rewriteCss(ctx.args[1], client.meta);
		},
	});

	// `element.style` is the same live `CSSStyleDeclaration` on every read, and
	// the DOM guarantees `el.style === el.style`. Building the wrapper fresh per
	// read broke that identity (frameworks that cache and compare it saw a new
	// object each time) and allocated two proxies on a path pages take in tight
	// loops. One wrapper per declaration instead.
	const styleWrappers = new WeakMap<
		CSSStyleDeclaration,
		CSSStyleDeclaration
	>();

	// unfortunate and dumb hack. we have to trap every property of this since
	// the prototype chain is fucked
	function wrapStyleDeclaration(
		style: CSSStyleDeclaration
	): CSSStyleDeclaration {
		const cached = styleWrappers.get(style);
		if (cached) return cached;

		// The declaration's own methods are rebound so they still run against
		// the real object; those bindings are per-declaration too, so
		// `el.style.setProperty === el.style.setProperty` holds as it does in
		// the DOM.
		const boundMethods = new Map<string | symbol, unknown>();

		const wrapper = new Proxy(style, {
			get(target, prop) {
				const value = Reflect.get(target, prop);

				if (typeof value === "function") {
					const bound = boundMethods.get(prop);
					if (bound) return bound;

					const rebound = new Proxy(value, {
						apply(method, _that, args) {
							return Reflect.apply(method, style, args);
						},
					});
					boundMethods.set(prop, rebound);

					return rebound;
				}

				if (prop in self.CSSStyleDeclaration.prototype) return value;
				if (!value) return value;

				return unrewriteCss(value);
			},
			set(target, prop, value) {
				if (prop == "cssText" || value == "" || typeof value !== "string") {
					return Reflect.set(target, prop, value);
				}

				return Reflect.set(target, prop, rewriteCss(value, client.meta));
			},
		});

		styleWrappers.set(style, wrapper);

		return wrapper;
	}

	client.Trap("HTMLElement.prototype.style", {
		get(ctx) {
			return wrapStyleDeclaration(ctx.get() as CSSStyleDeclaration);
		},
		set(ctx, value: string) {
			// this will actually run the trap for cssText. don't rewrite it here
			ctx.set(value);
		},
	});

	// A computed style is a `CSSStyleDeclaration` too, and it is the one sites
	// actually read URLs out of - `getComputedStyle(el).backgroundImage` is how
	// you find out what image an element is showing. Only the inline
	// declaration was wrapped, so that read handed the page Sherpa's proxied
	// URL. (`getPropertyValue` was already covered, which is what made the gap
	// easy to miss: the two spellings of the same read disagreed.)
	client.Proxy("getComputedStyle", {
		apply(ctx) {
			const style = ctx.call() as CSSStyleDeclaration | null;
			if (!style) return ctx.return(style);

			ctx.return(wrapStyleDeclaration(style));
		},
	});
}
