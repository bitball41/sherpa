// i am a cat. i like to be petted. i like to be fed. i like to be
import { initSync, Rewriter } from "../../../rewriter/wasm/out/wasm.js";
import type { JsRewriterOutput } from "../../../rewriter/wasm/out/wasm.js";
import { codecDecode, codecEncode, config, flagEnabled } from "@/shared";

export type { JsRewriterOutput, Rewriter };

import { base64ToBytes } from "@/shared/base64";

let wasm_u8: Uint8Array<ArrayBuffer> | undefined;
let wasmLoadPromise: Promise<Uint8Array<ArrayBuffer>> | null = null;
let compiledModule: WebAssembly.Module | undefined;
let compileInFlight = false;
let compileGen = 0;

declare const REWRITERWASM: string | undefined;

type WasmHolder = {
	WASM?: string;
	__scramjetWasm?: Promise<ArrayBuffer>;
	__scramjetWasmBuffer?: ArrayBuffer | Uint8Array<ArrayBuffer>;
	/** @deprecated Prefer `__scramjetWasm`; kept for in-flight pages mid-upgrade. */
	__sherpaWasm?: Promise<ArrayBuffer>;
	/** @deprecated Prefer `__scramjetWasmBuffer`. */
	__sherpaWasmBuffer?: ArrayBuffer | Uint8Array<ArrayBuffer>;
};

function wasmHolder(): WasmHolder {
	return self as unknown as WasmHolder;
}

function takePendingWasmBuffer(): Uint8Array<ArrayBuffer> | undefined {
	const holder = wasmHolder();
	const pending = holder.__scramjetWasmBuffer ?? holder.__sherpaWasmBuffer;
	if (pending instanceof ArrayBuffer) return new Uint8Array(pending);
	if (pending instanceof Uint8Array) return pending;
	if (typeof holder.WASM === "string") return base64ToBytes(holder.WASM);

	return undefined;
}

function setWasmBytes(
	bytes: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
	if (wasm_u8 === bytes && (compiledModule || compileInFlight)) return bytes;

	if (wasm_u8 !== bytes) {
		compiledModule = undefined;
		compileInFlight = false;
		compileGen++;
	}
	wasm_u8 = bytes;
	// Overlap compilation with the rest of boot (`loadAndHook`, trap install).
	// `getRewriter` is synchronous, so if this has not finished we still fall
	// back to `new WebAssembly.Module` on first use.
	if (
		typeof WebAssembly === "undefined" ||
		typeof WebAssembly.compile !== "function"
	)
		return bytes;

	const gen = compileGen;
	compileInFlight = true;
	void WebAssembly.compile(bytes).then(
		(mod) => {
			if (gen === compileGen) compiledModule = mod;
		},
		() => {
			if (gen === compileGen) compileInFlight = false;
		}
	);

	return bytes;
}

if (REWRITERWASM) setWasmBytes(base64ToBytes(REWRITERWASM));
else {
	const pending = takePendingWasmBuffer();
	if (pending) setWasmBytes(pending);
}

/** The rewriter bytes already loaded in this realm, if any. */
export function getWasmBytes(): Uint8Array<ArrayBuffer> | undefined {
	return wasm_u8;
}

// only use in sw
export async function asyncSetWasm() {
	const response = await fetch(config.files.wasm);
	if (!response.ok) {
		throw new Error(
			`failed to fetch rewriter wasm: HTTP ${response.status} ${response.statusText}`
		);
	}
	setWasmBytes(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Starts (or joins) the binary WASM fetch the document's prefetch script
 * kicked off. Safe to call when the bytes are already present - including
 * the `REWRITERWASM`-embedded bundle, which never fetches.
 */
export function beginWasmFetch(
	url: string
): Promise<Uint8Array<ArrayBuffer>> {
	if (wasm_u8) return Promise.resolve(wasm_u8);
	const existing = takePendingWasmBuffer();
	if (existing) {
		return Promise.resolve(setWasmBytes(existing));
	}
	if (wasmLoadPromise) return wasmLoadPromise;

	const started = wasmHolder().__scramjetWasm ?? wasmHolder().__sherpaWasm;
	wasmLoadPromise = Promise.resolve(
		started ??
			fetch(url).then((response) => {
				if (!response.ok) {
					throw new Error(
						`failed to fetch rewriter wasm: HTTP ${response.status} ${response.statusText}`
					);
				}

				return response.arrayBuffer();
			})
	).then((buf) => {
		const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

		return setWasmBytes(bytes);
	});
	wasmLoadPromise.catch(() => {
		wasmLoadPromise = null;
	});

	return wasmLoadPromise;
}

function loadWasmSync(url: string): Uint8Array<ArrayBuffer> {
	try {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url, false);
		xhr.responseType = "arraybuffer";
		xhr.send(null);
		if (xhr.response instanceof ArrayBuffer)
			return new Uint8Array(xhr.response);
	} catch {
		// Firefox rejects non-default `responseType` on a synchronous XHR.
	}

	const xhr = new XMLHttpRequest();
	xhr.open("GET", url, false);
	xhr.overrideMimeType("text/plain; charset=x-user-defined");
	xhr.send(null);
	const text = xhr.responseText;
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;

	return bytes;
}

function ensureWasmBytes(): Uint8Array<ArrayBuffer> {
	if (wasm_u8) return wasm_u8;
	const pending = takePendingWasmBuffer();
	if (pending) return setWasmBytes(pending);

	return setWasmBytes(loadWasmSync(config.files.wasm));
}

export const textDecoder = new TextDecoder();
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d] as const;

let wasmInitialized = false;

function initWasm() {
	// initSync latches onto the first module it's given and ignores later
	// calls, but its argument was still being evaluated every time - meaning
	// a full synchronous WebAssembly.Module compile of the rewriter on EVERY
	// JS rewrite. Latch here instead so the compile happens exactly once.
	if (wasmInitialized) return;

	const bytes = ensureWasmBytes();
	if (!(bytes instanceof Uint8Array))
		throw new Error("rewriter wasm not found (was it fetched correctly?)");

	if (
		bytes[0] !== WASM_MAGIC[0] ||
		bytes[1] !== WASM_MAGIC[1] ||
		bytes[2] !== WASM_MAGIC[2] ||
		bytes[3] !== WASM_MAGIC[3]
	)
		throw new Error(
			"rewriter wasm does not have wasm magic (was it fetched correctly?)\nrewriter wasm contents: " +
				textDecoder.decode(bytes)
		);

	initSync({
		module: compiledModule ?? new WebAssembly.Module(bytes),
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
