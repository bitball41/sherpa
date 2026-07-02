// Micro benchmark: Sherpa vs upstream Scramjet 1.x shared rewriters.
//
// Methodology (designed to be defensible):
//   - Both variants are bundled from source by build.mjs and run in the SAME
//     Node process, so V8 version, GC, and machine state are common-mode.
//   - Iterations are interleaved in alternating blocks (ABBA order rotates
//     each round) so thermal drift / frequency scaling can't systematically
//     favor whichever variant runs later.
//   - Per-iteration wall time via performance.now(); warmup iterations are
//     discarded so steady-state JIT-compiled code is measured.
//   - We report median (robust to GC outliers), p95, and MiB/s, plus the
//     Mann-Whitney U effect direction via a simple win rate.
//   - Identical config (prefix, codec, flag values, injected-global names)
//     is fed to both variants so the ONLY difference is engine code.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));

// ---- browser-global shims (must exist before the bundles are imported) ----
globalThis.self = globalThis;
globalThis.location = new URL("https://proxy.invalid/");
globalThis.__benchdbg = {
	log() {},
	warn() {},
	error() {},
	debug() {},
	time() {},
};

const sherpa = await import(join(benchDir, "out/sherpa.rewriters.mjs"));
const upstream = await import(join(benchDir, "out/upstream.rewriters.mjs"));

// Identical config for both variants (all of these are config-driven in both
// engines, so pinning them equal is a fair, controlled comparison).
function makeConfig() {
	return {
		prefix: "/proxy/",
		globals: {
			wrapfn: "$proxy$wrap",
			wrappropertybase: "$proxy__",
			wrappropertyfn: "$proxy$prop",
			cleanrestfn: "$proxy$clean",
			importfn: "$proxy$import",
			rewritefn: "$proxy$rewrite",
			metafn: "$proxy$meta",
			setrealmfn: "$proxy$setrealm",
			pushsourcemapfn: "$proxy$pushsourcemap",
			trysetfn: "$proxy$tryset",
			templocid: "$proxy$temploc",
			tempunusedid: "$proxy$tempunused",
		},
		files: {
			wasm: "/engine.wasm.wasm",
			all: "/engine.all.js",
			sync: "/engine.sync.js",
		},
		flags: {
			serviceworkers: false,
			syncxhr: false,
			strictRewrites: true,
			rewriterLogs: false,
			captureErrors: true,
			cleanErrors: false,
			scramitize: false,
			sourcemaps: false,
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

sherpa.setConfig(makeConfig());
upstream.setConfig(makeConfig());

const ORIGIN = new URL("https://example.com/section/page.html");
const makeMeta = () => ({ origin: ORIGIN, base: ORIGIN });

// ---- fixtures ----
const corpusDir = join(benchDir, "corpus/out");
if (!existsSync(corpusDir)) {
	console.error("corpus missing - run `npm run corpus` first");
	process.exit(1);
}
const read = (f) => readFileSync(join(corpusDir, f), "utf8");

const htmlFixtures = [
	"small.html",
	"spa.html",
	"news.html",
	"shop.html",
	"article.html",
];
const cssFixtures = ["site.css", "framework.css"];
const urls = JSON.parse(read("urls.json"));

// Live fixtures (real captured pages), if present. Not committed; see README.
const liveDir = join(benchDir, "fixtures-live");
const liveFixtures = [];
if (existsSync(liveDir)) {
	for (const f of (await import("node:fs")).readdirSync(liveDir)) {
		if (f.endsWith(".html")) liveFixtures.push(f);
	}
}

// ---- benchmark cases ----
const cases = [];

for (const f of htmlFixtures) {
	const html = read(f);
	cases.push({
		name: `rewriteHtml ${f}`,
		bytes: Buffer.byteLength(html),
		run: (v) => v.rewriteHtml(html, new v.CookieStore(), makeMeta(), true),
	});
}
for (const f of liveFixtures) {
	const html = readFileSync(join(liveDir, f), "utf8");
	cases.push({
		name: `rewriteHtml [live] ${f}`,
		bytes: Buffer.byteLength(html),
		run: (v) => v.rewriteHtml(html, new v.CookieStore(), makeMeta(), true),
	});
}
for (const f of cssFixtures) {
	const css = read(f);
	cases.push({
		name: `rewriteCss ${f}`,
		bytes: Buffer.byteLength(css),
		run: (v) => v.rewriteCss(css, makeMeta()),
	});
}
cases.push({
	name: `rewriteUrl x${urls.length}`,
	bytes: urls.reduce((a, u) => a + u.length, 0),
	run: (v) => {
		const meta = makeMeta();
		let acc = 0;
		for (const u of urls) acc += v.rewriteUrl(u, meta).length;

		return acc;
	},
});
{
	// unrewrite: feed each variant its own rewritten output (round-trip)
	const meta = makeMeta();
	const pre = {
		sherpa: urls.map((u) => sherpa.rewriteUrl(u, meta)),
		upstream: urls.map((u) => upstream.rewriteUrl(u, meta)),
	};
	cases.push({
		name: `unrewriteUrl x${urls.length}`,
		bytes: urls.reduce((a, u) => a + u.length, 0),
		run: (v, which) => {
			let acc = 0;
			for (const u of pre[which]) acc += v.unrewriteUrl(u).length;

			return acc;
		},
	});
}

// ---- measurement ----
const WARMUP = Number(process.env.BENCH_WARMUP ?? 10);
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 12);
const ITERS = Number(process.env.BENCH_ITERS ?? 5); // per variant per round

function stats(samples) {
	const s = [...samples].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
	const mean = s.reduce((a, b) => a + b, 0) / s.length;
	const sd = Math.sqrt(
		s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1)
	);

	return { n: s.length, median: q(0.5), p95: q(0.95), mean, sd, min: s[0] };
}

let sink = 0; // defeat dead-code elimination

const results = [];
for (const c of cases) {
	const samples = { sherpa: [], upstream: [] };
	const variants = { sherpa, upstream };

	// warmup both
	for (const which of ["sherpa", "upstream"]) {
		for (let i = 0; i < WARMUP; i++) {
			const r = c.run(variants[which], which);
			sink += typeof r === "string" ? r.length : r;
		}
	}

	for (let round = 0; round < ROUNDS; round++) {
		// rotate order each round: AB BA AB BA ...
		const order =
			round % 2 === 0 ? ["sherpa", "upstream"] : ["upstream", "sherpa"];
		for (const which of order) {
			for (let i = 0; i < ITERS; i++) {
				const t0 = performance.now();
				const r = c.run(variants[which], which);
				const t1 = performance.now();
				sink += typeof r === "string" ? r.length : r;
				samples[which].push(t1 - t0);
			}
		}
	}

	const st = {
		sherpa: stats(samples.sherpa),
		upstream: stats(samples.upstream),
	};

	// win rate: fraction of paired (round-matched) comparisons Sherpa wins
	let wins = 0;
	for (let i = 0; i < samples.sherpa.length; i++)
		if (samples.sherpa[i] < samples.upstream[i]) wins++;

	results.push({
		case: c.name,
		bytes: c.bytes,
		samplesPerVariant: samples.sherpa.length,
		sherpa: st.sherpa,
		upstream: st.upstream,
		speedup: st.upstream.median / st.sherpa.median,
		sherpaMiBps: c.bytes / 1048576 / (st.sherpa.median / 1000),
		upstreamMiBps: c.bytes / 1048576 / (st.upstream.median / 1000),
		winRate: wins / samples.sherpa.length,
	});

	const r = results[results.length - 1];
	console.log(
		`${c.name.padEnd(34)} sherpa ${r.sherpa.median.toFixed(3).padStart(9)}ms  ` +
			`scramjet ${r.upstream.median.toFixed(3).padStart(9)}ms  ` +
			`speedup ${r.speedup.toFixed(2)}x  win ${(r.winRate * 100).toFixed(0)}%`
	);
}

const out = {
	date: new Date().toISOString(),
	node: process.version,
	v8: process.versions.v8,
	os: `${process.platform} ${process.arch}`,
	cpu: (await import("node:os")).cpus()[0]?.model ?? "unknown",
	params: { WARMUP, ROUNDS, ITERS },
	upstreamRef:
		"57ba89e (== @mercuryworkshop/scramjet@1.1.0, frozen legacy line)",
	results,
	sink,
};

mkdirSync(join(benchDir, "results"), { recursive: true });
const file = join(
	benchDir,
	"results",
	`micro-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
writeFileSync(file, JSON.stringify(out, null, "\t"));
console.log(`\nwrote ${file}`);
