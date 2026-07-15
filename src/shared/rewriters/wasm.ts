// i am a cat. i like to be petted. i like to be fed. i like to be
import { initSync, Rewriter as WasmRewriter } from "../../../rewriter/wasm/out/wasm.js";
import { codecDecode, codecEncode, config, flagEnabled } from "@/shared";

import { rewriteUrl, URLMeta } from "@rewriters/url";
import { htmlRules } from "@/shared/htmlRules";
import { rewriteCss } from "@rewriters/css";
import { rewriteJs } from "@rewriters/js";
import { getInjectScripts } from "@rewriters/html";
import { CookieStore } from "@/shared/cookie";
import { base64ToBytes } from "@/shared/base64";

export type JsRewriterOutput = {
	js: Uint8Array;
	map: Uint8Array;
	scramtag: string;
	errors: string[];
};

export interface Rewriter {
	rewrite_js(
		js: string,
		base: string,
		url: string,
		module: boolean
	): JsRewriterOutput;
	rewrite_js_bytes(
		js: Uint8Array,
		base: string,
		url: string,
		module: boolean
	): JsRewriterOutput;
	free(): void;
}

let wasm_u8: Uint8Array<ArrayBuffer>;

declare const REWRITERWASM: string | undefined;
if (REWRITERWASM) wasm_u8 = base64ToBytes(REWRITERWASM);
else if (self.WASM) wasm_u8 = base64ToBytes(self.WASM);

// only use in sw
export async function asyncSetWasm() {
	const response = await fetch(config.files.wasm);
	if (!response.ok) {
		throw new Error(
			`failed to fetch rewriter wasm: HTTP ${response.status} ${response.statusText}`
		);
	}
	const buf = await response.arrayBuffer();
	wasm_u8 = new Uint8Array(buf);
}

export const textDecoder = new TextDecoder();
const MAGIC = "\0asm".split("").map((x) => x.charCodeAt(0));

let wasmInitialized = false;

function initWasm() {
	// initSync latches onto the first module it's given and ignores later
	// calls, but its argument was still being evaluated every time - meaning
	// a full synchronous WebAssembly.Module compile of the rewriter on EVERY
	// JS rewrite. Latch here instead so the compile happens exactly once.
	if (wasmInitialized) return;

	if (!(wasm_u8 instanceof Uint8Array))
		throw new Error("rewriter wasm not found (was it fetched correctly?)");

	if (![...wasm_u8.slice(0, 4)].every((x, i) => x === MAGIC[i]))
		throw new Error(
			"rewriter wasm does not have wasm magic (was it fetched correctly?)\nrewriter wasm contents: " +
				textDecoder.decode(wasm_u8)
		);

	initSync({
		module: new WebAssembly.Module(wasm_u8),
	});
	wasmInitialized = true;
}

type PooledRewriter = {
	rewriter: Rewriter;
	inUse: boolean;
	stale: boolean;
};
const rewriters: PooledRewriter[] = [];
let poolConfig = config;

export function getRewriter(meta: URLMeta): [Rewriter, () => void] {
	initWasm();

	// A WASM Rewriter snapshots the prefix, global names, and codec callback in
	// its constructor. setConfig() replaces the config object, so cached
	// instances must not survive a runtime configuration update.
	if (poolConfig !== config) {
		for (const obj of rewriters) {
			if (obj.inUse) obj.stale = true;
			else obj.rewriter.free();
		}
		rewriters.length = 0;
		poolConfig = config;
	}

	let obj: PooledRewriter;
	const index = rewriters.findIndex((x) => !x.inUse);
	const len = rewriters.length;

	if (index === -1) {
		if (flagEnabled("rewriterLogs", meta.base))
			console.log(`creating new rewriter, ${len} rewriters made already`);

		const rewriter = new WasmRewriter({
			config,
			shared: {
				rewrite: {
					htmlRules,
					rewriteUrl,
					rewriteCss,
					rewriteJs,
					getHtmlInjectCode(cookieStore: CookieStore, foundHead: boolean) {
						const inject = getInjectScripts(
							cookieStore,
							(src) => `<script src="${src}"></script>`
						).join("");

						return foundHead ? `<head>${inject}</head>` : inject;
					},
				},
			},
			flagEnabled,
			codec: {
				encode: codecEncode,
				decode: codecDecode,
			},
		});
		obj = { rewriter, inUse: false, stale: false };
		rewriters.push(obj);
	} else {
		if (flagEnabled("rewriterLogs", meta.base))
			console.log(
				`using cached rewriter ${index} from list of ${len} rewriters`
			);

		obj = rewriters[index];
	}
	obj.inUse = true;

	return [
		obj.rewriter,
		() => {
			if (!obj.inUse) return;
			obj.inUse = false;
			if (obj.stale) obj.rewriter.free();
		},
	];
}
