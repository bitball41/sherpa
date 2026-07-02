// Identical stub substituted for `@rewriters/js` in BOTH benchmark variants.
//
// The actual JavaScript rewriter is a Rust/WASM module. Sherpa's WASM
// rewriter and upstream Scramjet 1.x's are built from the same code, so its
// cost is common-mode for the micro benchmark; stubbing it out identically on
// both sides isolates the TypeScript pipelines (HTML/CSS/URL) that actually
// differ between the two. The end-to-end browser benchmark exercises the real
// WASM path in both engines.
export function rewriteJs(js) {
	return js;
}

export function rewriteJsInner(js) {
	return { js, tag: "", map: null, errors: [] };
}
