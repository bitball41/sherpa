import { ElementType, Parser } from "htmlparser2";
import { ChildNode, DomHandler, Element, Comment } from "domhandler";
import render from "dom-serializer";
import { URLMeta, rewriteUrl, snapshotMeta } from "@rewriters/url";
import { rewriteCss } from "@rewriters/css";
import { rewriteJs } from "@rewriters/js";
import { rewriteImportMap } from "@rewriters/importMap";
import { rewriteRefresh } from "@rewriters/refresh";
import { CookieStore } from "@/shared/cookie";
import { config } from "@/shared";
import { findHtmlRule } from "@/shared/htmlRules";
import { appendUrlParams, resolveBaseHref } from "@/shared/urlCodec";
import { INTERNAL_PARAMS } from "@/shared/internalParams";
import { base64ToBytes, bytesToBase64 } from "@/shared/base64";
import {
	SCRIPT_SOURCE_ATTRIBUTE,
	SHADOW_ATTRIBUTE_PREFIX,
} from "@/shared/shadowAttributes";

export { SCRIPT_SOURCE_ATTRIBUTE, SHADOW_ATTRIBUTE_PREFIX };

// `JSON.stringify(config)` walks the whole configuration (flags, per-site flag
// overrides, the error-page theme, both codec sources) and it is embedded,
// unchanged, in the boot script of every single proxied document and iframe.
// The configuration object is replaced wholesale by `setConfig`, never mutated
// in place, so identity is a sound cache key.
let serializedConfig = "";
let serializedConfigSource: object | null = null;

let lastInjectedSource: string | null = null;
let lastInjectedBase64 = "";

function configLiteral(): string {
	if (serializedConfigSource !== config) {
		serializedConfigSource = config;
		serializedConfig = JSON.stringify(config);
	}

	return serializedConfig;
}

export function getInjectScripts<T>(
	cookieStore: CookieStore,
	script: (src: string) => T
): T[] {
	const dump = JSON.stringify(cookieStore.dump());
	const injected = `
		self.COOKIE = ${dump};
		$sherpaLoadClient().loadAndHook(${configLiteral()});
		if ("document" in self && document?.currentScript) {
			document.currentScript.remove();
		}
	`;

	// for compatibility purpose
	//
	// A page and every iframe on it are rewritten against the same jar and the
	// same configuration, so this is the same few kilobytes being UTF-8 encoded
	// and base64'd over and over within one navigation.
	if (injected !== lastInjectedSource) {
		lastInjectedSource = injected;
		lastInjectedBase64 = bytesToBase64(encoder.encode(injected));
	}
	const base64Injected = lastInjectedBase64;

	return [
		script(config.files.wasm),
		script(config.files.all),
		script("data:application/javascript;base64," + base64Injected),
	];
}

const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
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
	// Resolve the caller's meta once. The traversal both reads it for every
	// URL it rewrites and *writes* to `base` when it meets a `<base href>`;
	// the client hands us a getter-only meta, where that write throws.
	traverseParsedHtml(handler.root, cookieStore, snapshotMeta(meta));

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
	// Every `innerHTML`/`outerHTML`/`getHTML()` read routes through here, and
	// the only thing this function does is undo `sherpa-attr-*` shadow
	// attributes. Markup that carries none of them needs no work - and
	// round-tripping it through the parser + serializer anyway was not just
	// wasted time, it also handed the page back re-serialized markup (quoting,
	// entities and void/self-closing tags normalized) rather than its own.
	if (typeof html !== "string" || !html.includes(SHADOW_ATTRIBUTE_PREFIX))
		return html;

	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	parser.write(html);
	parser.end();

	function traverse(node: ChildNode) {
		if ("attribs" in node) {
			for (const key in node.attribs) {
				if (key == SCRIPT_SOURCE_ATTRIBUTE) {
					// The source was UTF-8 encoded before it was base64'd, so it
					// has to be decoded the same way round. `atob` alone yields
					// one character per *byte*, which mojibakes every inline
					// script containing a non-ASCII character (an accented
					// string literal, an emoji, any CJK text) the moment a page
					// reads its own `innerHTML` back.
					if (node.children[0] && "data" in node.children[0])
						node.children[0].data = utf8Decoder.decode(
							base64ToBytes(node.attribs[key])
						);
					continue;
				}

				if (key.startsWith(SHADOW_ATTRIBUTE_PREFIX)) {
					node.attribs[key.slice(SHADOW_ATTRIBUTE_PREFIX.length)] =
						node.attribs[key];
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

type TraversalState = { baseHrefSeen: boolean };

function traverseParsedHtml(
	node: any,
	cookieStore: CookieStore,
	meta: URLMeta,
	state: TraversalState = { baseHrefSeen: false }
) {
	// only element nodes carry attribs; gating on it lets the text/comment
	// nodes that make up most of a document skip all tag handling below
	const attribs = node.attribs;
	if (attribs !== undefined) {
		const name = node.name;

		if (name === "base" && attribs.href !== undefined && !state.baseHrefSeen) {
			// Per HTML, only the first <base href> participates in document URL
			// resolution. An invalid first value is still first; later elements do
			// not get to silently replace it.
			state.baseHrefSeen = true;
			const resolvedBase = resolveBaseHref(attribs.href, meta.base);
			if (resolvedBase) meta.base = resolvedBase;
		}

		// A snapshot, so the `sherpa-attr-*` entries added below stay out of the
		// iteration. No attribute is both rule-rewritable and an event handler,
		// so one pass covers what used to be two walks of every element's
		// attribute list.
		const attributes = Object.keys(attribs);
		for (let i = 0; i < attributes.length; i++) {
			const attr = attributes[i];
			const rule = findHtmlRule(attr, name);

			if (rule) {
				const value = attribs[attr];
				const rewritten = rule.fn(value, meta, cookieStore);

				if (rewritten === null) delete attribs[attr];
				else attribs[attr] = rewritten;
				attribs[SHADOW_ATTRIBUTE_PREFIX + attr] = value;
			} else if (isEventAttribute(attr)) {
				const value = attribs[attr];
				attribs[SHADOW_ATTRIBUTE_PREFIX + attr] = value;
				attribs[attr] = rewriteJs(value, `(inline ${attr} on element)`, meta);
			}
		}

		if (name === "style") {
			if (node.children[0] !== undefined)
				node.children[0].data = rewriteCss(node.children[0].data, meta);
		} else if (name === "script") {
			// the type's MIME essence decides everything below; compute it once
			const type = attribs.type;
			const essence = scriptTypeEssence(type);

			if (essence === "module" && attribs.src) {
				attribs.src = appendUrlParams(attribs.src, {
					[INTERNAL_PARAMS.type]: "module",
				});
			}

			if (essence === "importmap" && node.children[0] !== undefined) {
				const json = node.children[0].data;
				try {
					const map = JSON.parse(json);
					rewriteImportMap(map, (url) => rewriteUrl(url, meta));

					node.children[0].data = JSON.stringify(map);
				} catch (e) {
					console.error("Failed to parse importmap JSON:", e);
				}
			}
			if (
				(essence === "module" || jsMimeEssences.test(essence)) &&
				node.children[0] !== undefined
			) {
				const js = node.children[0].data;
				const module = essence === "module";
				attribs[SCRIPT_SOURCE_ATTRIBUTE] = bytesToBase64(encoder.encode(js));
				node.children[0].data = rewriteJs(
					js,
					"(inline script element)",
					meta,
					module
				);
			}
		} else if (name === "meta" && attribs["http-equiv"] !== undefined) {
			node = rewriteMetaHttpEquiv(node, meta);
		}
	}

	if (node.childNodes) {
		const children = node.childNodes;
		for (let i = 0; i < children.length; i++) {
			children[i] = traverseParsedHtml(children[i], cookieStore, meta, state);
		}
	}

	return node;
}

function rewriteMetaHttpEquiv(node: any, meta: URLMeta) {
	const httpEquiv = node.attribs["http-equiv"].toLowerCase();
	if (httpEquiv === "content-security-policy") {
		// just delete it. this needs to be emulated eventually but like
		node = new Comment(node.attribs.content);
	} else if (httpEquiv === "refresh" && node.attribs.content) {
		// content looks like "<seconds>[; url=<url>]"; the same directive can
		// also arrive as the HTTP `Refresh` header, so the parsing is shared.
		node.attribs.content = rewriteRefresh(node.attribs.content, (url) =>
			rewriteUrl(url, meta)
		);
	}

	return node;
}

// whitespace test for srcset scanning: char-code comparisons for the ASCII
// range (all realistic srcsets), regex fallback for exotic unicode whitespace
// so behavior matches /\s/ exactly
function isSrcsetSpace(code: number): boolean {
	if (code === 32 || (code >= 9 && code <= 13)) return true;
	if (code < 128) return false;

	return /\s/.test(String.fromCharCode(code));
}

export function rewriteSrcset(srcset: string, meta: URLMeta) {
	// candidates can't be naively split on commas: URLs may contain commas
	// (data: URIs) and only a comma outside parentheses ends a descriptor.
	// this follows the HTML spec's srcset parsing algorithm: a URL runs to the
	// next whitespace, a trailing comma on the URL ends the candidate, and
	// otherwise the descriptor runs to the next top-level comma
	const candidates: string[] = [];
	const len = srcset.length;
	let pos = 0;

	while (pos < len) {
		while (pos < len) {
			const c = srcset.charCodeAt(pos);
			if (c !== 44 /* , */ && !isSrcsetSpace(c)) break;
			pos++;
		}
		if (pos >= len) break;

		const urlStart = pos;
		while (pos < len && !isSrcsetSpace(srcset.charCodeAt(pos))) pos++;
		let url = srcset.slice(urlStart, pos);

		let descriptor = "";
		if (url.endsWith(",")) {
			url = url.replace(/,+$/, "");
		} else {
			while (pos < len && isSrcsetSpace(srcset.charCodeAt(pos))) pos++;
			const descStart = pos;
			let parens = 0;
			while (pos < len) {
				const c = srcset.charCodeAt(pos);
				if (c === 40 /* ( */) parens++;
				else if (c === 41 /* ) */ && parens > 0) parens--;
				else if (c === 44 /* , */ && parens === 0) break;
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

// a script executes as (classic) JS when its type's essence matches this or
// is "module"; the traversal above tests `essence === "module" ||
// jsMimeEssences.test(essence)` with the essence it already computed
const jsMimeEssences =
	/^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^text\/(?:javascript1\.[0-5]|jscript|livescript)$/;

// function base64ToBytes(base64) {
// 	const binString = atob(base64);

// 	return Uint8Array.from(binString, (m) => m.codePointAt(0));
// }

export { bytesToBase64 };
const eventAttributes = new Set([
	"onafterprint",
	"onbeforexrselect",
	"onabort",
	"onbeforeinput",
	"onbeforematch",
	"onbeforeprint",
	"onbeforetoggle",
	"onbeforeunload",
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
	"onfullscreenchange",
	"onfullscreenerror",
	"onhashchange",
	"oninput",
	"oninvalid",
	"onkeydown",
	"onkeypress",
	"onkeyup",
	"onload",
	"onloadeddata",
	"onloadedmetadata",
	"onloadstart",
	"onlanguagechange",
	"onmessage",
	"onmessageerror",
	"onmousedown",
	"onmouseenter",
	"onmouseleave",
	"onmousemove",
	"onmouseout",
	"onmouseover",
	"onmouseup",
	"onmousewheel",
	"onoffline",
	"ononline",
	"onpagehide",
	"onpageshow",
	"onpause",
	"onplay",
	"onplaying",
	"onprogress",
	"onpopstate",
	"onpointerlockchange",
	"onpointerlockerror",
	"onratechange",
	"onreadystatechange",
	"onrejectionhandled",
	"onreset",
	"onresize",
	"onscroll",
	"onsecuritypolicyviolation",
	"onseeked",
	"onseeking",
	"onselect",
	"onslotchange",
	"onstalled",
	"onstorage",
	"onsubmit",
	"onsuspend",
	"ontimeupdate",
	"ontoggle",
	"onunhandledrejection",
	"onunload",
	"onvisibilitychange",
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

export function isEventAttribute(name: string): boolean {
	// Runs for every attribute of every element in every rewritten document,
	// and for every `setAttribute` a page makes. Almost none of them start
	// with "on", so reject on two character codes before allocating a
	// lowercased copy of the name.
	if (name.length < 3) return false;
	if ((name.charCodeAt(0) | 0x20) !== 111 /* o */) return false;
	if ((name.charCodeAt(1) | 0x20) !== 110 /* n */) return false;

	return eventAttributes.has(name.toLowerCase());
}
