import { config } from "@/shared";
import { rewriteJs } from "@rewriters/js";
import { URLMeta } from "@rewriters/url";
import { configLiteral, wasmSyncLoaderSource } from "@/shared/bootScripts";

export function rewriteWorkers(
	js: string | Uint8Array,
	type: string,
	url: string,
	meta: URLMeta
) {
	let str = "";
	const module = type === "module";
	if (module) {
		// Imports are hoisted, so a static `import` of the runtime would
		// evaluate before this fetch. Dynamic import after the await keeps
		// `loadAndHook` from running until the binary is in hand.
		str += `self.__sherpaWasmBuffer=await(await fetch(${JSON.stringify(config.files.wasm)})).arrayBuffer();\n`;
		str += `await import(${JSON.stringify(config.files.all)});\n`;
	} else {
		str += wasmSyncLoaderSource(config.files.wasm);
		str += `importScripts(${JSON.stringify(config.files.all)});\n`;
	}
	str += `$sherpaLoadClient().loadAndHook(${configLiteral()});`;

	let rewritten = rewriteJs(js, url, meta, module);
	if (rewritten instanceof Uint8Array) {
		rewritten = new TextDecoder().decode(rewritten);
	}

	str += rewritten;

	return str;
}
