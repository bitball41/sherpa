// What does the REAL rewriter pipeline cost per resource, and what does it
// do to wire size? The published micro benchmark (../micro.mjs) deliberately
// stubbed the WASM JS rewriter (common-mode vs upstream) and ran with
// `sourcemaps: false` - so neither the oxc rewrite cost nor the default-on
// sourcemap payload ever showed up in those numbers. This measures both,
// using the committed dist bundle (real WASM embedded via REWRITERWASM).
//
//   node bottleneck/rewrite-cost.mjs        (run from bench/)
//
// For every fixture it reports, under default flags (sourcemaps ON - the
// SherpaController default) and with sourcemaps OFF:
//   - median rewrite wall time (the service worker blocks on this per response)
//   - output bytes vs input bytes (what actually goes over the wire to the page)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(benchDir, "..");

// browser-global shims, needed before the bundle is imported
globalThis.self = globalThis;
globalThis.location = new URL("https://proxy.invalid/");

const engine = await import(join(repoRoot, "dist/sherpa.bundle.js"));

function makeConfig(sourcemaps) {
	return {
		prefix: "/proxied/",
		globals: {
			wrapfn: "$sherpa$wrap",
			wrappropertybase: "$sherpa__",
			wrappropertyfn: "$sherpa$prop",
			cleanrestfn: "$sherpa$clean",
			importfn: "$sherpa$import",
			rewritefn: "$sherpa$rewrite",
			metafn: "$sherpa$meta",
			setrealmfn: "$sherpa$setrealm",
			pushsourcemapfn: "$sherpa$pushsourcemap",
			trysetfn: "$sherpa$tryset",
			templocid: "$sherpa$temploc",
			tempunusedid: "$sherpa$tempunused",
		},
		files: {
			wasm: "/sherpa.wasm.wasm",
			all: "/sherpa.all.js",
			sync: "/sherpa.sync.js",
		},
		// SherpaController defaults (controller.ts), sourcemaps toggled per run
		flags: {
			serviceworkers: false,
			syncxhr: false,
			strictRewrites: true,
			rewriterLogs: false,
			captureErrors: true,
			cleanErrors: false,
			scramitize: false,
			sourcemaps,
			destructureRewrites: false,
			interceptDownloads: false,
			allowInvalidJs: true,
			allowFailedIntercepts: true,
		},
		siteFlags: {},
		errorPage: {},
		codec: {
			encode:
				"(url) => { if (!url) return url; return encodeURIComponent(url); }",
			decode:
				"(url) => { if (!url) return url; return decodeURIComponent(url); }",
		},
	};
}

const ORIGIN = new URL("https://example.com/section/page.html");
const makeMeta = () => ({ origin: ORIGIN, base: ORIGIN });

const corpusDir = join(benchDir, "corpus/out");
if (!existsSync(corpusDir)) {
	console.error("corpus missing - run `npm run corpus` in bench/ first");
	process.exit(1);
}

// fixtures: the e2e corpus JS, a real published minified web bundle
// (scramjet.all.js - representative of what sites actually ship), and the
// e2e HTML pages
const { jsFiles, pages } = await import(join(benchDir, "e2e/fixtures.mjs"));

const jsCases = [
	["fixture app0.js", jsFiles["/js/app0.js"]],
	[
		"real minified bundle (scramjet.all.js, 176 KiB)",
		readFileSync(
			join(
				benchDir,
				"node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js"
			),
			"utf8"
		),
	],
];
const htmlCases = [
	["e2e landing.html", pages["/landing.html"]],
	["e2e article.html", pages["/article.html"]],
	[
		"corpus spa.html (script-heavy)",
		readFileSync(join(corpusDir, "spa.html"), "utf8"),
	],
	[
		"corpus article.html",
		readFileSync(join(corpusDir, "article.html"), "utf8"),
	],
];

const WARMUP = 3;
const N = 21;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kib = (n) => (n / 1024).toFixed(1).padStart(8) + " KiB";

function bench(fn) {
	for (let i = 0; i < WARMUP; i++) fn();
	const t = [];
	let out;
	for (let i = 0; i < N; i++) {
		const t0 = performance.now();
		out = fn();
		t.push(performance.now() - t0);
	}

	return { ms: median(t), out };
}

const encoder = new TextEncoder();
const outBytes = (o) =>
	typeof o === "string" ? encoder.encode(o).length : o.length;

for (const sourcemaps of [true, false]) {
	engine.setConfig(makeConfig(sourcemaps));
	engine.loadCodecs();
	console.log(
		`\n=== sourcemaps: ${sourcemaps} ${sourcemaps ? "(SherpaController DEFAULT)" : ""} ===`
	);

	console.log("\n-- rewriteJs (the service worker's script-response path) --");
	for (const [name, src] of jsCases) {
		const bytes = encoder.encode(src);
		const inN = bytes.length;
		// same call shape as worker/fetch.ts: Uint8Array in
		const r = bench(() =>
			engine.rewriteJs(
				bytes.slice(),
				"https://example.com/app.js",
				makeMeta(),
				false
			)
		);
		const oN = outBytes(r.out);
		console.log(
			`${name.padEnd(50)} in ${kib(inN)}  out ${kib(oN)} (${(oN / inN).toFixed(2)}x)  ${r.ms.toFixed(2).padStart(8)} ms  (${(inN / 1048576 / (r.ms / 1000)).toFixed(1)} MiB/s)`
		);
	}

	console.log("\n-- rewriteHtml (document path; includes inline scripts) --");
	const jar = { dump: () => "{}" };
	for (const [name, src] of htmlCases) {
		const inN = encoder.encode(src).length;
		const r = bench(() => engine.rewriteHtml(src, jar, makeMeta(), true));
		const oN = outBytes(r.out);
		console.log(
			`${name.padEnd(50)} in ${kib(inN)}  out ${kib(oN)} (${(oN / inN).toFixed(2)}x)  ${r.ms.toFixed(2).padStart(8)} ms  (${(inN / 1048576 / (r.ms / 1000)).toFixed(1)} MiB/s)`
		);
	}
}
