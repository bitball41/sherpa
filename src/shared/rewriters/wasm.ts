// i am a cat. i like to be petted. i like to be fed. i like to be
import { initSync, Rewriter } from "../../../rewriter/wasm/out/wasm.js";
import type { JsRewriterOutput } from "../../../rewriter/wasm/out/wasm.js";
import { codecDecode, codecEncode, config, flagEnabled } from "@/shared";

export type { JsRewriterOutput, Rewriter };

import { base64ToBytes } from "@/shared/base64";

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

export function getRewriter(base: URL): [Rewriter, () => void] {
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
	const len = rewriters.length;
	let index = -1;
	for (let i = 0; i < len; i++) {
		if (!rewriters[i].inUse) {
			index = i;
			break;
		}
	}

	if (index === -1) {
		if (flagEnabled("rewriterLogs", base))
			console.log(`creating new rewriter, ${len} rewriters made already`);

		// `Rewriter::new` reads exactly three keys — `config`, `codec` and
		// `flagEnabled` (see `rewriter/wasm/src/{lib,jsr}.rs`). The rewriter is
		// a *JavaScript* rewriter; HTML, CSS and URL rewriting all happen in
		// TypeScript. A `shared.rewrite` bag carrying `htmlRules`,
		// `rewriteUrl`, `rewriteCss`, `rewriteJs` and an HTML-injection
		// callback used to be handed over with it, none of which the Rust side
		// has ever looked at — and importing them here made this module and
		// `@rewriters/html` mutually dependent for nothing.
		const rewriter = new Rewriter({
			config,
			flagEnabled,
			codec: {
				encode: codecEncode,
				decode: codecDecode,
			},
		});
		obj = { rewriter, inUse: false, stale: false };
		rewriters.push(obj);
	} else {
		if (flagEnabled("rewriterLogs", base))
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
