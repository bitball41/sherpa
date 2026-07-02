// Stub for `rewriter/wasm/out/wasm.js` (the wasm-bindgen glue) so the shared
// rewriter barrel can be bundled for Node without the WASM artifact present.
// Never called at benchmark time: `@rewriters/js` is stubbed above it.
export function initSync() {}
export class Rewriter {
	constructor() {}
}
