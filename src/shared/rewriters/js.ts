import { config, flagEnabled } from "@/shared";
import { URLMeta } from "@rewriters/url";

import { getRewriter, JsRewriterOutput, textDecoder } from "@rewriters/wasm";
import { bytesToBase64 } from "@/shared/base64";

Error.stackTraceLimit = 50;

type RewriterResult = {
	js: string | Uint8Array;
	map: Uint8Array | null;
	tag: string;
	errors: string[];
};
function rewriteJsWasm(
	input: string | Uint8Array,
	source: string | null,
	meta: URLMeta,
	base: URL,
	module: boolean
): RewriterResult {
	const [rewriter, ret] = getRewriter(base);

	try {
		let out: JsRewriterOutput;
		const before = performance.now();
		// try {
		if (typeof input === "string") {
			out = rewriter.rewrite_js(
				input,
				base.href,
				source || "(unknown)",
				module
			);
		} else {
			out = rewriter.rewrite_js_bytes(
				input,
				base.href,
				source || "(unknown)",
				module
			);
		}
		// } catch (err) {
		// 	const err1 = err as Error;
		// 	console.warn(
		// 		"failed rewriting js for",
		// 		source,
		// 		err1.message,
		// 		input instanceof Uint8Array ? textDecoder.decode(input) : input
		// 	);

		// 	return { js: input, tag: "", map: null };
		// }
		dbg.time(meta, before, `oxc rewrite for "${source || "(unknown)"}"`);

		const { js, map, scramtag, errors } = out;

		return {
			js: typeof input === "string" ? textDecoder.decode(js) : js,
			tag: scramtag,
			map,
			errors,
		};
	} finally {
		ret();
	}
}

export function rewriteJsInner(
	js: string | Uint8Array,
	url: string | null,
	meta: URLMeta,
	module = false
) {
	return rewriteJsWasm(js, url, meta, meta.base, module);
}

// don't put the sourcemap call before "use strict"
const strictMode = /^\s*(['"])use strict\1;?/;

export function rewriteJs(
	js: string | Uint8Array,
	url: string | null,
	meta: URLMeta,
	module = false
): string | Uint8Array {
	// `meta.base` is an accessor in the client realm (DOM query + proxied-URL
	// decode + URL parse). Every flag check and the rewriter call itself want
	// it, so resolve it exactly once per script.
	const base = meta.base;
	try {
		const res = rewriteJsWasm(js, url, meta, base, module);
		let newjs = res.js;

		// `map` is optional: a rewriter build without map emission returns null,
		// and blowing up on it here used to drop the whole (already successful)
		// rewrite and hand the page its original, unproxied script.
		if (res.map && flagEnabled("sourcemaps", base)) {
			const pushmap = globalThis[config.globals.pushsourcemapfn];
			if (pushmap) {
				pushmap(res.map, res.tag);
			} else {
				if (newjs instanceof Uint8Array) {
					newjs = textDecoder.decode(newjs);
				}
				// Serialized as base64 rather than a decimal array literal: the
				// literal cost ~4 characters per map byte on the wire and forced
				// the page's JS parser to materialize an array of that length
				// before the script could run. This is the same map in ~1.34
				// characters per byte, parsed as a single string.
				const sourcemapfn = `${config.globals.pushsourcemapfn}("${bytesToBase64(res.map)}", "${res.tag}");`;

				if (strictMode.test(newjs)) {
					newjs = newjs.replace(strictMode, `$&\n${sourcemapfn}`);
				} else {
					newjs = `${sourcemapfn}\n${newjs}`;
				}
			}
		}

		if (flagEnabled("rewriterLogs", base)) {
			for (const error of res.errors) {
				console.error("oxc parse error", error);
			}
		}

		return newjs;
	} catch (err) {
		console.warn(
			"failed rewriting js for",
			url || "(unknown)",
			err.message,
			js instanceof Uint8Array ? textDecoder.decode(js) : js
		);
		if (flagEnabled("allowInvalidJs", base)) {
			return js;
		} else {
			throw err;
		}
	}
}
