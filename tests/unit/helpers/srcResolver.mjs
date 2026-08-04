/**
 * A module-resolution hook that lets `node --test` load engine sources
 * directly.
 *
 * `src/` is written for the bundler: it uses the `@/`, `@client/` and
 * `@rewriters/` path aliases from `tsconfig.json`, and extension-less relative
 * specifiers. Node's ESM resolver understands neither. Registering this hook
 * teaches it both, so a test can exercise a real engine module instead of a
 * copy of its logic.
 *
 * Only modules that are leaf-ish enough to run outside a browser are worth
 * loading this way - anything that reaches the WASM rewriter needs a Rust
 * build to exist.
 */

const SRC = new URL("../../../src/", import.meta.url);

const ALIASES = [
	["@rewriters/", "shared/rewriters/"],
	["@client/", "client/"],
	["@/", ""],
];

export async function resolve(specifier, context, nextResolve) {
	let resolved = specifier;

	for (const [alias, target] of ALIASES) {
		if (resolved.startsWith(alias)) {
			resolved = new URL(target + resolved.slice(alias.length), SRC).href;
			break;
		}
	}

	try {
		return await nextResolve(resolved, context);
	} catch (error) {
		// Extension-less specifier: the bundler fills in `.ts`, so do the same.
		if (/\.[a-z]+$/i.test(resolved)) throw error;

		return await nextResolve(`${resolved}.ts`, context);
	}
}
