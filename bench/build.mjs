// Bundles the shared rewriters (HTML/CSS/URL pipelines) of two source trees
// into Node-runnable ES modules so they can be benchmarked head-to-head in
// the same process:
//
//   - sherpa:   this repository's working tree (bench/../src)
//   - upstream: the exact commit Sherpa forked from (upstream Scramjet's
//               frozen `legacy` 1.x line == the published
//               @mercuryworkshop/scramjet@1.1.0), materialized as a git
//               worktree at bench/.upstream
//
// Both variants get the identical `@rewriters/js` stub (see shims/) so the
// common WASM JS rewriter is excluded equally from both sides.
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchDir, "..");

export const UPSTREAM_REF = "57ba89e"; // last upstream commit before the rebrand; upstream v1 is frozen
const upstreamDir = join(benchDir, ".upstream");

if (!existsSync(join(upstreamDir, "src"))) {
	console.log(`materializing upstream worktree @ ${UPSTREAM_REF} ...`);
	execSync(`git worktree add --detach "${upstreamDir}" ${UPSTREAM_REF}`, {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

const ENTRY = `
export { setConfig, config, loadCodecs } from "@/shared";
export { CookieStore } from "@/shared/cookie";
export { rewriteHtml, unrewriteHtml } from "@rewriters/html";
export { rewriteCss, unrewriteCss } from "@rewriters/css";
export { rewriteUrl, unrewriteUrl } from "@rewriters/url";
`;

function variantPlugin(srcRoot) {
	return {
		name: "variant-resolver",
		setup(b) {
			// virtual entry point
			b.onResolve({ filter: /^bench-entry$/ }, () => ({
				path: "bench-entry",
				namespace: "bench",
			}));
			b.onLoad({ filter: /^bench-entry$/, namespace: "bench" }, () => ({
				contents: ENTRY,
				resolveDir: srcRoot,
				loader: "ts",
			}));

			// identical JS-rewriter stub for both variants
			b.onResolve({ filter: /^@rewriters\/js$/ }, () => ({
				path: join(benchDir, "shims/js-stub.mjs"),
			}));
			b.onResolve({ filter: /^\.\/js$/ }, (args) => {
				if (args.resolveDir.endsWith(join("shared", "rewriters")))
					return { path: join(benchDir, "shims/js-stub.mjs") };

				return undefined;
			});

			// wasm-bindgen glue is absent in a fresh checkout; stub it (unused at
			// runtime because @rewriters/js is stubbed)
			b.onResolve({ filter: /rewriter\/wasm\/out\/wasm(\.js)?$/ }, () => ({
				path: join(benchDir, "shims/wasm-glue-stub.mjs"),
			}));

			// tsconfig path aliases, mirrored from rspack.config.js
			b.onResolve({ filter: /^@rewriters\// }, (args) => ({
				path: resolveTs(
					join(
						srcRoot,
						"shared/rewriters",
						args.path.slice("@rewriters/".length)
					)
				),
			}));
			b.onResolve({ filter: /^@client\// }, (args) => ({
				path: resolveTs(
					join(srcRoot, "client", args.path.slice("@client/".length))
				),
			}));
			b.onResolve({ filter: /^@\// }, (args) => ({
				path: resolveTs(join(srcRoot, args.path.slice(2))),
			}));
		},
	};
}

function resolveTs(p) {
	if (existsSync(`${p}.ts`)) return `${p}.ts`;
	if (existsSync(join(p, "index.ts"))) return join(p, "index.ts");

	return p;
}

async function bundle(name, srcRoot) {
	const outfile = join(benchDir, "out", `${name}.rewriters.mjs`);
	await build({
		entryPoints: ["bench-entry"],
		bundle: true,
		format: "esm",
		platform: "node",
		target: "es2022",
		outfile,
		sourcemap: false,
		logLevel: "warning",
		define: {
			REWRITERWASM: "undefined",
			VERSION: '"bench"',
			COMMITHASH: '"bench"',
			dbg: "globalThis.__benchdbg",
		},
		plugins: [variantPlugin(srcRoot)],
	});
	console.log(`built ${outfile}`);
}

mkdirSync(join(benchDir, "out"), { recursive: true });
await bundle("sherpa", join(repoRoot, "src"));
await bundle("upstream", join(upstreamDir, "src"));

// optional: a pinned pre-optimization Sherpa commit, used by verify.mjs to
// check output equivalence of the optimized rewriters
const baselineDir = join(benchDir, ".baseline");
if (process.env.BENCH_BASELINE_REF) {
	execSync(
		`git worktree add --force --detach "${baselineDir}" ${process.env.BENCH_BASELINE_REF}`,
		{ cwd: repoRoot, stdio: "inherit" }
	);
}
if (existsSync(join(baselineDir, "src"))) {
	await bundle("baseline", join(baselineDir, "src"));
}
