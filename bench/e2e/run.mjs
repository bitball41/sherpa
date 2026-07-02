// End-to-end page-load benchmark: Sherpa (this repo's dist/) vs the published
// @mercuryworkshop/scramjet@1.1.0 dist, both driven exactly the same way:
// real service worker, real WASM JS rewriter, same bare-mux/epoxy transport
// builds, same wisp server, same deterministic local fixture origin - so the
// only variable is the proxy engine.
//
//   cold load  = fresh browser context: SW install + engine init + first page
//   warm load  = same context, per-page navigations after warmup
//
// Loads are interleaved (engine order rotates each round) to neutralize
// machine drift. Reported: median and p95 of warm loads, median of cold.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
	startOriginServer,
	startHostServer,
	ORIGIN_PORT,
	HOST_PORTS,
} from "./servers.mjs";

const benchDir = dirname(fileURLToPath(import.meta.url));

const PAGES = ["/landing.html", "/article.html", "/app.html", "/gallery.html"];
const ROUNDS = Number(process.env.BENCH_E2E_ROUNDS ?? 3); // rounds per block
const WARMUP = Number(process.env.BENCH_E2E_WARMUP ?? 2); // warmup passes per block
const COLD_RUNS = Number(process.env.BENCH_E2E_COLD ?? 4);
const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;

function stats(samples) {
	const s = [...samples].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

	return {
		n: s.length,
		median: q(0.5),
		p95: q(0.95),
		min: s[0],
		max: s[s.length - 1],
	};
}

const servers = [
	await startOriginServer(),
	await startHostServer("sherpa"),
	await startHostServer("scramjet"),
];
console.log(
	`origin :${ORIGIN_PORT}  sherpa :${HOST_PORTS.sherpa}  scramjet :${HOST_PORTS.scramjet}`
);

const browser = await chromium.launch({
	// the environment ships a pinned chromium; PLAYWRIGHT_EXECUTABLE_PATH
	// overrides it if a different build should be used
	executablePath:
		process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium",
	args: ["--enable-features=SharedArrayBuffer"],
});

async function newHarness(engine) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on("pageerror", (e) =>
		console.error(`[${engine} pageerror]`, e.message)
	);
	await page.goto(`http://127.0.0.1:${HOST_PORTS[engine]}/bench.html`, {
		waitUntil: "load",
	});
	await page.waitForFunction(() => window.benchReady !== undefined);
	await page.evaluate(() => window.benchReady);

	return { context, page };
}

let retries = 0;
async function navigate(page, url) {
	try {
		return await page.evaluate((u) => window.benchNavigate(u), url);
	} catch (e) {
		// a proxied load can occasionally wedge (transport hiccup); retry once
		// and count it - retries are reported so flakiness stays visible
		retries++;
		console.error(`\nretrying ${url}: ${e.message.split("\n")[0]}`);

		return await page.evaluate((u) => window.benchNavigate(u), url);
	}
}

// ---- cold starts: fresh context each time, includes SW install + first page
const cold = { sherpa: [], scramjet: [] };
for (let i = 0; i < COLD_RUNS; i++) {
	const order = i % 2 === 0 ? ["sherpa", "scramjet"] : ["scramjet", "sherpa"];
	for (const engine of order) {
		const t0 = Date.now();
		const { context, page } = await newHarness(engine);
		const nav = await navigate(page, `${ORIGIN}/landing.html`);
		cold[engine].push({ total: Date.now() - t0, nav });
		await context.close();
	}
}
console.log("cold starts done");

// ---- warm loads, in short alternating blocks. Only ONE harness context is
// ever alive: a concurrently-idling second harness gets background-throttled
// by the browser and its transport can wedge, poisoning the measurement.
// Alternating whole blocks (ABBA order across blocks) still cancels machine
// drift, and warm samples pool across blocks.
const BLOCKS = Number(process.env.BENCH_E2E_BLOCKS ?? 4);
const warm = {};
for (const p of PAGES) warm[p] = { sherpa: [], scramjet: [] };

for (let block = 0; block < BLOCKS; block++) {
	const order =
		block % 2 === 0 ? ["sherpa", "scramjet"] : ["scramjet", "sherpa"];
	for (const engine of order) {
		const { context, page } = await newHarness(engine);
		for (let i = 0; i < WARMUP; i++) {
			for (const p of PAGES) await navigate(page, ORIGIN + p);
		}
		for (let round = 0; round < ROUNDS; round++) {
			for (const p of PAGES) {
				warm[p][engine].push(await navigate(page, ORIGIN + p));
			}
		}
		await context.close();
	}
	process.stdout.write(`\rblock ${block + 1}/${BLOCKS}`);
}
console.log();

const results = { pages: {}, cold: {} };
for (const p of PAGES) {
	const s = stats(warm[p].sherpa);
	const u = stats(warm[p].scramjet);
	results.pages[p] = { sherpa: s, scramjet: u, speedup: u.median / s.median };
	console.log(
		`${p.padEnd(16)} sherpa ${s.median.toFixed(1).padStart(8)}ms  scramjet ${u.median.toFixed(1).padStart(8)}ms  speedup ${(u.median / s.median).toFixed(2)}x`
	);
}
for (const engine of ["sherpa", "scramjet"]) {
	results.cold[engine] = {
		total: stats(cold[engine].map((c) => c.total)),
		nav: stats(cold[engine].map((c) => c.nav)),
	};
}
console.log(
	`cold (ctx+SW+first page)  sherpa ${results.cold.sherpa.total.median}ms  scramjet ${results.cold.scramjet.total.median}ms`
);

const out = {
	date: new Date().toISOString(),
	node: process.version,
	browser: browser.version(),
	params: { ROUNDS, WARMUP, COLD_RUNS, BLOCKS },
	scramjet: "@mercuryworkshop/scramjet@1.1.0 (published dist)",
	retries,
	results,
};
mkdirSync(join(benchDir, "../results"), { recursive: true });
const file = join(
	benchDir,
	"../results",
	`e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
writeFileSync(file, JSON.stringify(out, null, "\t"));
console.log(`wrote ${file}`);

await browser.close();
for (const s of servers) s.close();
process.exit(0);
