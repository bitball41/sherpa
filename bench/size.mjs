// Wire-cost comparison: what each engine makes the host page download.
// Raw, gzip (default web compression), and brotli sizes for every runtime
// artifact, Sherpa's dist/ vs the published @mercuryworkshop/scramjet@1.1.0.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";

const benchDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchDir, "..");

const ARTIFACTS = [
	["all.js", "runtime bundle (controller+client+worker)"],
	["sync.js", "sync xhr helper"],
	["wasm.wasm", "JS rewriter (WASM)"],
];

const variants = {
	sherpa: { dir: join(repoRoot, "dist"), prefix: "sherpa" },
	scramjet: {
		dir: join(benchDir, "node_modules/@mercuryworkshop/scramjet/dist"),
		prefix: "scramjet",
	},
};

const fmt = (n) => (n / 1024).toFixed(1).padStart(8) + " KiB";
const results = {};

let totals = {
	sherpa: { raw: 0, gzip: 0, brotli: 0 },
	scramjet: { raw: 0, gzip: 0, brotli: 0 },
};

for (const [suffix, desc] of ARTIFACTS) {
	results[suffix] = {};
	for (const [name, v] of Object.entries(variants)) {
		const buf = readFileSync(join(v.dir, `${v.prefix}.${suffix}`));
		const sizes = {
			raw: buf.length,
			gzip: gzipSync(buf, { level: 6 }).length,
			brotli: brotliCompressSync(buf).length,
		};
		results[suffix][name] = sizes;
		totals[name].raw += sizes.raw;
		totals[name].gzip += sizes.gzip;
		totals[name].brotli += sizes.brotli;
	}
	const s = results[suffix].sherpa;
	const u = results[suffix].scramjet;
	console.log(`${suffix.padEnd(10)} (${desc})`);
	console.log(
		`  raw    sherpa ${fmt(s.raw)}   scramjet ${fmt(u.raw)}   (${((1 - s.raw / u.raw) * 100).toFixed(1)}% smaller)`
	);
	console.log(
		`  gzip   sherpa ${fmt(s.gzip)}   scramjet ${fmt(u.gzip)}   (${((1 - s.gzip / u.gzip) * 100).toFixed(1)}% smaller)`
	);
	console.log(
		`  brotli sherpa ${fmt(s.brotli)}   scramjet ${fmt(u.brotli)}   (${((1 - s.brotli / u.brotli) * 100).toFixed(1)}% smaller)`
	);
}

console.log(`\nTOTAL (what a page actually downloads)`);
for (const metric of ["raw", "gzip", "brotli"]) {
	const s = totals.sherpa[metric];
	const u = totals.scramjet[metric];
	console.log(
		`  ${metric.padEnd(6)} sherpa ${fmt(s)}   scramjet ${fmt(u)}   (${((1 - s / u) * 100).toFixed(1)}% smaller)`
	);
}

mkdirSync(join(benchDir, "results"), { recursive: true });
writeFileSync(
	join(
		benchDir,
		"results",
		`size-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
	),
	JSON.stringify(
		{ date: new Date().toISOString(), results, totals },
		null,
		"\t"
	)
);
