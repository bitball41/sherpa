// Self-regression benchmark: this working tree vs. a pinned earlier Sherpa
// commit, rather than vs. upstream Scramjet.
//
// The main micro benchmark answers "is Sherpa faster than the engine it
// forked?". This one answers "did the change I just made actually help?" -
// and it makes the distinction the other harnesses cannot: the shared
// rewriters run in two very different realms.
//
//   - In the service worker, `URLMeta` is a plain object built per request.
//   - In a proxied page, `origin`/`base` are accessors that decode the
//     proxied location and query the document for `<base>` on *every* read.
//
// A rewrite that reads `meta.base` once per URL it touches is nearly free in
// the first realm and expensive in the second, so both are measured, along
// with a raw count of how many times each variant reads those accessors -
// which is the realm-independent number.
//
//   BENCH_BASELINE_REF=<commit> node build.mjs && node regression.mjs
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));

globalThis.self = globalThis;
globalThis.location = new URL("https://proxy.invalid/");
globalThis.__benchdbg = {
	log() {},
	warn() {},
	error() {},
	debug() {},
	time() {},
};

if (!existsSync(join(benchDir, "out/baseline.rewriters.mjs"))) {
	console.error(
		"baseline bundle missing - run `BENCH_BASELINE_REF=<commit> node build.mjs` first"
	);
	process.exit(1);
}

const after = await import(join(benchDir, "out/sherpa.rewriters.mjs"));
const before = await import(join(benchDir, "out/baseline.rewriters.mjs"));

const PREFIX = "/proxy/";
const PROXY_ORIGIN = "https://proxy.invalid";

function makeConfig() {
	return {
		prefix: PREFIX,
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
			encode: "(url) => (url ? encodeURIComponent(url) : url)",
			decode: "(url) => (url ? decodeURIComponent(url) : url)",
		},
	};
}

for (const variant of [before, after]) {
	variant.setConfig(makeConfig());
	variant.loadCodecs();
}

const PAGE_URL = new URL("https://site.test/a/b.html");
const PROXIED_HREF = PROXY_ORIGIN + PREFIX + encodeURIComponent(PAGE_URL.href);

/** A worker-realm meta: plain values, no accessors. */
const workerMeta = () => ({
	origin: new URL(PAGE_URL),
	base: new URL(PAGE_URL),
});

/**
 * A page-realm meta. The real client also runs `querySelector("base")` on the
 * document per read, which cannot be simulated here - so every number this
 * produces is a floor for the browser.
 */
function pageMeta(counter) {
	const resolve = () => {
		counter.reads++;

		return new URL(
			decodeURIComponent(PROXIED_HREF.slice((PROXY_ORIGIN + PREFIX).length))
		);
	};

	return {
		get origin() {
			return resolve();
		},
		get base() {
			return resolve();
		},
		get topFrameName() {
			return undefined;
		},
		get parentFrameName() {
			return undefined;
		},
	};
}

// ---- fixtures ------------------------------------------------------------
const corpusDir = join(benchDir, "corpus/out");
function corpus(name, fallback) {
	const path = join(corpusDir, name);

	return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

const css = corpus(
	"site.css",
	Array.from(
		{ length: 400 },
		(_, i) =>
			`.c${i}{background:url("/img/${i}.png");border-image:url(/b/${i}.svg)}`
	).join("\n")
);

const html = corpus(
	"article.html",
	`<!doctype html><html><head><title>t</title></head><body>${Array.from(
		{ length: 300 },
		(_, i) =>
			`<div class="row"><a href="/l/${i}">l${i}</a><img src="/i/${i}.png" alt="a"><span>text ${i}</span></div>`
	).join("")}</body></html>`
);

// what `element.innerHTML` hands back for a subtree Sherpa never rewrote -
// no `sherpa-attr-*` shadow attributes anywhere in it
const untouchedMarkup = `<ul>${Array.from(
	{ length: 400 },
	(_, i) => `<li class="item" data-id="${i}"><span>row ${i}</span></li>`
).join("")}</ul>`;

// ---- harness -------------------------------------------------------------
function time(fn, iterations) {
	for (let i = 0; i < 5; i++) fn();
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();

	return (performance.now() - start) / iterations;
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);

	return sorted[sorted.length >> 1];
}

const results = [];
function compare(name, make, iterations, rounds = 15) {
	const b = [];
	const a = [];
	// alternate the order every round so drift can't favor either side
	for (let round = 0; round < rounds; round++) {
		if (round % 2 === 0) {
			b.push(time(make(before), iterations));
			a.push(time(make(after), iterations));
		} else {
			a.push(time(make(after), iterations));
			b.push(time(make(before), iterations));
		}
	}
	const baseline = median(b);
	const current = median(a);
	results.push({
		case: name,
		"baseline (ms)": baseline.toFixed(3),
		"current (ms)": current.toFixed(3),
		speedup: `${(baseline / current).toFixed(2)}x`,
	});
}

const stores = new Map([
	[before, new before.CookieStore()],
	[after, new after.CookieStore()],
]);

compare(
	"unrewriteHtml, no shadow attributes",
	(v) => () => v.unrewriteHtml(untouchedMarkup),
	30
);
compare(
	"rewriteCss (page realm)",
	(v) => {
		const meta = pageMeta({ reads: 0 });

		return () => v.rewriteCss(css, meta);
	},
	20
);
compare(
	"rewriteCss (worker realm)",
	(v) => {
		const meta = workerMeta();

		return () => v.rewriteCss(css, meta);
	},
	20
);
compare(
	"rewriteHtml (page realm)",
	(v) => {
		const meta = pageMeta({ reads: 0 });

		return () => v.rewriteHtml(html, stores.get(v), meta, false);
	},
	20
);
compare(
	"rewriteHtml (worker realm)",
	(v) => {
		const meta = workerMeta();

		return () => v.rewriteHtml(html, stores.get(v), meta, false);
	},
	20
);

console.log("\nthroughput (median of 15 interleaved rounds)");
console.table(results);

// ---- realm-independent: how often the meta accessors are read ------------
const reads = [];
for (const [label, variant] of [
	["baseline", before],
	["current", after],
]) {
	const cssCounter = { reads: 0 };
	variant.rewriteCss(css, pageMeta(cssCounter));
	const htmlCounter = { reads: 0 };
	variant.rewriteHtml(html, stores.get(variant), pageMeta(htmlCounter), false);
	reads.push({
		variant: label,
		"per stylesheet": cssCounter.reads,
		"per document": htmlCounter.reads,
	});
}
console.log(
	"\nmeta accessor reads (each one is a proxied-URL decode + a <base> DOM query in a page)"
);
console.table(reads);
