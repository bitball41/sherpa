// Client-side hot paths, measured inside a real proxied page.
//
// The other harnesses here measure the *service worker* side: rewriter
// throughput, wire size, page-load wall time. None of them touch what a
// proxied page pays while its own JavaScript runs - every trapped DOM call,
// every wrapped global access. That cost is proportional to how much the page
// does, not to how big it is, so a page-load benchmark cannot see it.
//
//   node bench/client-hotpath.mjs                     (this tree only)
//   SHERPA_BASELINE_DIST=/path/to/dist node bench/client-hotpath.mjs   (A/B)
//
// With a baseline dist the two engines are served from two identical local
// proxy hosts and the workloads run in alternating blocks, so drift cannot
// systematically favor either side.
import { chromium } from "playwright";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	startOriginServer,
	startHostServer,
	ORIGIN_PORT,
} from "../tests/behavior/servers.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineDist = process.env.SHERPA_BASELINE_DIST;

const ROUNDS = Number(process.env.SHERPA_BENCH_ROUNDS || 7);

// A page with no <base> and a few thousand nodes: the ordinary shape of a real
// document, and the case where resolving the document base is most expensive.
function workloadPage() {
	const filler = [];
	for (let i = 0; i < 900; i++) {
		filler.push(
			`<div class="row r${i % 12}"><span>row ${i}</span><em>${i}</em></div>`
		);
	}

	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>hot path</title></head>
<body>
<div id="content">${filler.join("")}</div>
<a id="probe" href="/start.html" data-a="1" data-b="2" title="t">probe</a>
<script>
window.__bench = {};

// Every URL-valued attribute a page assigns is rewritten, and rewriting has to
// resolve the document's base URL first.
window.__bench.urlAttributes = function (n) {
	var a = document.createElement("a");
	var t0 = performance.now();
	for (var i = 0; i < n; i++) a.setAttribute("href", "/product/" + i + ".html");
	return performance.now() - t0;
};

// Registering a listener had to scan every listener already on the target.
window.__bench.listeners = function (n) {
	var target = document.getElementById("content");
	var fns = [];
	for (var i = 0; i < n; i++) fns.push(function () {});
	var t0 = performance.now();
	for (var i = 0; i < n; i++) target.addEventListener("evt" + i, fns[i]);
	for (var i = 0; i < n; i++) target.removeEventListener("evt" + i, fns[i]);
	return performance.now() - t0;
};

// Walking element.attributes is what analytics and framework code does to
// snapshot an element.
window.__bench.attributes = function (n) {
	var el = document.getElementById("probe");
	var count = 0;
	var t0 = performance.now();
	for (var i = 0; i < n; i++) {
		var attrs = el.attributes;
		for (var j = 0; j < attrs.length; j++) count += attrs[j].name.length;
	}
	window.__attrCount = count;
	return performance.now() - t0;
};

// Minified code reuses "top"/"parent" as ordinary local names, and every one of
// those reads goes through the wrap function.
window.__bench.wrapfn = function (n) {
	function scaled(top, parent) { return top * 2 + parent; }
	var acc = 0;
	var t0 = performance.now();
	for (var i = 0; i < n; i++) acc += scaled(i, 1);
	window.__wrapAcc = acc;
	return performance.now() - t0;
};

// Dispatching an event runs the whole listener wrapper.
window.__bench.dispatch = function (n) {
	var target = document.getElementById("probe");
	var hits = 0;
	target.addEventListener("tick", function () { hits++; });
	var ev = new Event("tick");
	var t0 = performance.now();
	for (var i = 0; i < n; i++) target.dispatchEvent(ev);
	window.__hits = hits;
	return performance.now() - t0;
};
</script>
</body></html>`;
}

const WORKLOADS = [
	{ name: "url attribute assignment", fn: "urlAttributes", n: 20000 },
	{ name: "addEventListener/remove", fn: "listeners", n: 4000 },
	{ name: "element.attributes walk", fn: "attributes", n: 20000 },
	{ name: "wrapped local identifiers", fn: "wrapfn", n: 300000 },
	{ name: "event dispatch", fn: "dispatch", n: 30000 },
];

const engines = [
	{ label: "this tree", dist: join(repoRoot, "dist"), port: 4731 },
];
if (baselineDist)
	engines.push({ label: "baseline", dist: baselineDist, port: 4732 });

const servers = [
	await startOriginServer({ extraPages: { "/hot.html": workloadPage() } }),
];
for (const engine of engines) {
	servers.push(
		await startHostServer({ port: engine.port, distDir: engine.dist })
	);
}

const browser = await chromium.launch({
	executablePath: process.env.SHERPA_CHROMIUM || undefined,
});

const samples = new Map(); // `${engine}\0${workload}` -> number[]

function recordSample(engine, name, ms) {
	const key = `${engine.label}\0${name}`;
	if (!samples.has(key)) samples.set(key, []);
	samples.get(key).push(ms);
}

async function runEngine(engine) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`http://127.0.0.1:${engine.port}/harness.html`);
	await page.evaluate(() => window.harnessReady);
	const navStart = Date.now();
	const href = await page.evaluate(
		(url) => window.harnessNavigate(url),
		`http://127.0.0.1:${ORIGIN_PORT}/hot.html`
	);
	recordSample(engine, "first proxied navigation", Date.now() - navStart);
	const frame = page
		.frames()
		.find((f) => f !== page.mainFrame() && f.url() === href);
	if (!frame) throw new Error("proxied frame not found");
	await frame.waitForFunction(() => typeof window.__bench === "object");

	for (const workload of WORKLOADS) {
		// one discarded warmup so JIT state is comparable
		await frame.evaluate(
			([fn, n]) => window.__bench[fn](n),
			[workload.fn, Math.max(1, Math.floor(workload.n / 10))]
		);
		const ms = await frame.evaluate(
			([fn, n]) => window.__bench[fn](n),
			[workload.fn, workload.n]
		);
		recordSample(engine, workload.name, ms);
	}

	await context.close();
}

try {
	for (let round = 0; round < ROUNDS; round++) {
		// alternate direction each round so warm-up and thermal drift cancel
		const order = round % 2 === 0 ? engines : [...engines].reverse();
		for (const engine of order) await runEngine(engine);
	}
} finally {
	await browser.close();
	for (const server of servers) server.close();
}

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);

	return s.length % 2
		? s[(s.length - 1) / 2]
		: (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

console.log(`\nn=${ROUNDS} rounds, median ms (lower is better)\n`);
const pad = (s, n) => String(s).padEnd(n);
const padStart = (s, n) => String(s).padStart(n);

let header = pad("workload", 28);
for (const engine of engines) header += padStart(engine.label, 14);
if (engines.length === 2) header += padStart("speedup", 12);
console.log(header);
console.log("-".repeat(header.length));

for (const workload of [
	...WORKLOADS,
	{ name: "first proxied navigation", n: 1 },
]) {
	let line = pad(`${workload.name} (${workload.n})`, 28);
	const medians = engines.map((engine) =>
		median(samples.get(`${engine.label}\0${workload.name}`))
	);
	for (const value of medians) line += padStart(value.toFixed(2), 14);
	if (medians.length === 2)
		line += padStart(`${(medians[1] / medians[0]).toFixed(2)}x`, 12);
	console.log(line);
}
console.log();
