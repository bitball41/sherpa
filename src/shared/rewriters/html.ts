import { ElementType, Parser } from "htmlparser2";
import { ChildNode, DomHandler, Element, Comment } from "domhandler";
import render from "dom-serializer";
import { URLMeta, rewriteUrl } from "@rewriters/url";
import { rewriteCss } from "@rewriters/css";
import { rewriteJs } from "@rewriters/js";
import { CookieStore } from "@/shared/cookie";
import { config } from "@/shared";
import { findHtmlRule } from "@/shared/htmlRules";

export function getInjectScripts<T>(
	cookieStore: CookieStore,
	script: (src: string) => T
): T[] {
	const dump = JSON.stringify(cookieStore.dump());
	const injected = `
		self.COOKIE = ${dump};
		$sherpaLoadClient().loadAndHook(${JSON.stringify(config)});
		if ("document" in self && document?.currentScript) {
			document.currentScript.remove();
		}
	`;

	// for compatibility purpose
	const base64Injected = bytesToBase64(encoder.encode(injected));

	return [
		script(config.files.wasm),
		script(config.files.all),
		script("data:application/javascript;base64," + base64Injected),
	];
}

const encoder = new TextEncoder();
function rewriteHtmlInner(
	html: string,
	cookieStore: CookieStore,
	meta: URLMeta,
	fromTop: boolean = false
) {
	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	parser.write(html);
	parser.end();
	traverseParsedHtml(handler.root, cookieStore, meta);

	function findhead(node) {
		if (node.type === ElementType.Tag && node.name === "head") {
			return node as Element;
		} else if (node.childNodes) {
			for (const child of node.childNodes) {
				const head = findhead(child);
				if (head) return head;
			}
		}

		return null;
	}

	if (fromTop) {
		let head = findhead(handler.root);
		if (!head) {
			head = new Element("head", {}, []);
			handler.root.children.unshift(head);
		}

		const script = (src: string) => new Element("script", { src });
		head.children.unshift(...getInjectScripts(cookieStore, script));
	}

	return render(handler.root, {
		encodeEntities: "utf8",
		decodeEntities: false,
	});
}

export function rewriteHtml(
	html: string,
	cookieStore: CookieStore,
	meta: URLMeta,
	fromTop: boolean = false
) {
	const before = performance.now();
	const ret = rewriteHtmlInner(html, cookieStore, meta, fromTop);
	dbg.time(meta, before, "html rewrite");

	return ret;
}

// type ParseState = {
// 	base: string;
// 	origin?: URL;
// };

export function unrewriteHtml(html: string) {
	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	parser.write(html);
	parser.end();

	function traverse(node: ChildNode) {
		if ("attribs" in node) {
			for (const key in node.attribs) {
				if (key == "sherpa-attr-script-source-src") {
					if (node.children[0] && "data" in node.children[0])
						node.children[0].data = atob(node.attribs[key]);
					continue;
				}

				if (key.startsWith("sherpa-attr-")) {
					node.attribs[key.slice("sherpa-attr-".length)] = node.attribs[key];
					delete node.attribs[key];
				}
			}
		}

		if ("childNodes" in node) {
			for (const child of node.childNodes) {
				traverse(child);
			}
		}
	}

	traverse(handler.root);

	return render(handler.root, {
		decodeEntities: false,
	});
}

// i need to add the attributes in during rewriting

function traverseParsedHtml(
	node: any,
	cookieStore: CookieStore,
	meta: URLMeta
) {
	if (node.name === "base" && node.attribs.href !== undefined) {
		meta.base = new URL(node.attribs.href, meta.origin);
	}

	if (node.attribs) {
		const attributes = Object.keys(node.attribs);
		for (const attr of attributes) {
			const rule = findHtmlRule(attr, node.name);
			if (!rule) continue;

			const value = node.attribs[attr];
			const rewritten = rule.fn(value, meta, cookieStore);

			if (rewritten === null) delete node.attribs[attr];
			else node.attribs[attr] = rewritten;
			node.attribs[`sherpa-attr-${attr}`] = value;
		}
		for (const attr of attributes) {
			if (eventAttributes.has(attr)) {
				const value = node.attribs[attr];
				node.attribs[`sherpa-attr-${attr}`] = value;
				node.attribs[attr] = rewriteJs(
					value,
					`(inline ${attr} on element)`,
					meta
				);
			}
		}
	}

	if (node.name === "style" && node.children[0] !== undefined)
		node.children[0].data = rewriteCss(node.children[0].data, meta);

	if (
		node.name === "script" &&
		scriptTypeEssence(node.attribs.type) === "module" &&
		node.attribs.src
	)
		node.attribs.src = node.attribs.src + "?type=module";

	if (
		node.name === "script" &&
		node.attribs.type === "importmap" &&
		node.children[0] !== undefined
	) {
		let json = node.children[0].data;
		try {
			const map = JSON.parse(json);
			if (map.imports) {
				for (const key in map.imports) {
					let url = map.imports[key];
					if (typeof url === "string") {
						url = rewriteUrl(url, meta);
						map.imports[key] = url;
					}
				}
			}

			node.children[0].data = JSON.stringify(map);
		} catch (e) {
			console.error("Failed to parse importmap JSON:", e);
		}
	}
	if (
		node.name === "script" &&
		isJsScriptType(node.attribs.type) &&
		node.children[0] !== undefined
	) {
		let js = node.children[0].data;
		const module = scriptTypeEssence(node.attribs.type) === "module";
		node.attribs["sherpa-attr-script-source-src"] = bytesToBase64(
			encoder.encode(js)
		);
		const htmlcomment = /<!--[\s\S]*?-->/g;
		js = js.replace(htmlcomment, "");
		node.children[0].data = rewriteJs(
			js,
			"(inline script element)",
			meta,
			module
		);
	}

	if (node.name === "meta" && node.attribs["http-equiv"] !== undefined) {
		if (
			node.attribs["http-equiv"].toLowerCase() === "content-security-policy"
		) {
			// just delete it. this needs to be emulated eventually but like
			node = new Comment(node.attribs.content);
		} else if (
			node.attribs["http-equiv"].toLowerCase() === "refresh" &&
			node.attribs.content
		) {
			// content looks like "<seconds>[; url=<url>]" — the url key is
			// ASCII case-insensitive and the value may be quoted
			node.attribs.content = node.attribs.content.replace(
				/(url\s*=\s*)([\s\S]*)/i,
				(_, key: string, rest: string) => {
					const url = rest.trim();
					const quote = /^['"]/.test(url) ? url[0] : "";
					if (quote) {
						const end = url.indexOf(quote, 1);
						const inner = end === -1 ? url.slice(1) : url.slice(1, end);

						return key + quote + rewriteUrl(inner.trim(), meta) + quote;
					}

					return key + rewriteUrl(url, meta);
				}
			);
		}
	}

	if (node.childNodes) {
		for (const childNode in node.childNodes) {
			node.childNodes[childNode] = traverseParsedHtml(
				node.childNodes[childNode],
				cookieStore,
				meta
			);
		}
	}

	return node;
}

export function rewriteSrcset(srcset: string, meta: URLMeta) {
	// candidates can't be naively split on commas: URLs may contain commas
	// (data: URIs) and only a comma outside parentheses ends a descriptor.
	// this follows the HTML spec's srcset parsing algorithm: a URL runs to the
	// next whitespace, a trailing comma on the URL ends the candidate, and
	// otherwise the descriptor runs to the next top-level comma
	const candidates: string[] = [];
	let pos = 0;

	while (pos < srcset.length) {
		while (pos < srcset.length && /[\s,]/.test(srcset[pos])) pos++;
		if (pos >= srcset.length) break;

		const urlStart = pos;
		while (pos < srcset.length && !/\s/.test(srcset[pos])) pos++;
		let url = srcset.slice(urlStart, pos);

		let descriptor = "";
		if (url.endsWith(",")) {
			url = url.replace(/,+$/, "");
		} else {
			while (pos < srcset.length && /\s/.test(srcset[pos])) pos++;
			const descStart = pos;
			let parens = 0;
			while (pos < srcset.length) {
				const c = srcset[pos];
				if (c === "(") parens++;
				else if (c === ")" && parens > 0) parens--;
				else if (c === "," && parens === 0) break;
				pos++;
			}
			descriptor = srcset.slice(descStart, pos).trim();
			pos++;
		}

		if (!url) continue;
		const rewritten = rewriteUrl(url, meta);
		candidates.push(descriptor ? `${rewritten} ${descriptor}` : rewritten);
	}

	return candidates.join(", ");
}

// per the HTML spec a script with no type or an empty type is classic JS, the
// comparison is ASCII case-insensitive, and MIME parameters don't affect the
// essence (`text/javascript;charset=utf-8` still executes)
function scriptTypeEssence(type: string | undefined): string {
	if (type === undefined) return "text/javascript";
	const essence = type.split(";")[0].trim().toLowerCase();

	return essence === "" ? "text/javascript" : essence;
}

const jsMimeEssences =
	/^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^text\/(?:javascript1\.[0-5]|jscript|livescript)$/;

function isJsScriptType(type: string | undefined): boolean {
	const essence = scriptTypeEssence(type);

	return essence === "module" || jsMimeEssences.test(essence);
}

// function base64ToBytes(base64) {
// 	const binString = atob(base64);

// 	return Uint8Array.from(binString, (m) => m.codePointAt(0));
// }

function bytesToBase64(bytes: Uint8Array) {
	const binString = Array.from(bytes, (byte) =>
		String.fromCodePoint(byte)
	).join("");

	return btoa(binString);
}
const eventAttributes = new Set([
	"onbeforexrselect",
	"onabort",
	"onbeforeinput",
	"onbeforematch",
	"onbeforetoggle",
	"onblur",
	"oncancel",
	"oncanplay",
	"oncanplaythrough",
	"onchange",
	"onclick",
	"onclose",
	"oncontentvisibilityautostatechange",
	"oncontextlost",
	"oncontextmenu",
	"oncontextrestored",
	"oncuechange",
	"ondblclick",
	"ondrag",
	"ondragend",
	"ondragenter",
	"ondragleave",
	"ondragover",
	"ondragstart",
	"ondrop",
	"ondurationchange",
	"onemptied",
	"onended",
	"onerror",
	"onfocus",
	"onformdata",
	"oninput",
	"oninvalid",
	"onkeydown",
	"onkeypress",
	"onkeyup",
	"onload",
	"onloadeddata",
	"onloadedmetadata",
	"onloadstart",
	"onmousedown",
	"onmouseenter",
	"onmouseleave",
	"onmousemove",
	"onmouseout",
	"onmouseover",
	"onmouseup",
	"onmousewheel",
	"onpause",
	"onplay",
	"onplaying",
	"onprogress",
	"onratechange",
	"onreset",
	"onresize",
	"onscroll",
	"onsecuritypolicyviolation",
	"onseeked",
	"onseeking",
	"onselect",
	"onslotchange",
	"onstalled",
	"onsubmit",
	"onsuspend",
	"ontimeupdate",
	"ontoggle",
	"onvolumechange",
	"onwaiting",
	"onwebkitanimationend",
	"onwebkitanimationiteration",
	"onwebkitanimationstart",
	"onwebkittransitionend",
	"onwheel",
	"onauxclick",
	"ongotpointercapture",
	"onlostpointercapture",
	"onpointerdown",
	"onpointermove",
	"onpointerrawupdate",
	"onpointerup",
	"onpointercancel",
	"onpointerover",
	"onpointerout",
	"onpointerenter",
	"onpointerleave",
	"onselectstart",
	"onselectionchange",
	"onanimationend",
	"onanimationiteration",
	"onanimationstart",
	"ontransitionrun",
	"ontransitionstart",
	"ontransitionend",
	"ontransitioncancel",
	"oncopy",
	"oncut",
	"onpaste",
	"onscrollend",
	"onscrollsnapchange",
	"onscrollsnapchanging",
]);
