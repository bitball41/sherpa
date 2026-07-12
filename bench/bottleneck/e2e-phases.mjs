// Bottleneck attribution for a full Sherpa-proxied page load.
//
// The published e2e benchmark (../e2e/run.mjs) answers "is Sherpa faster than
// Scramjet 1.x?" on a localhost fixture. This harness answers a different
// question: "where does a Sherpa page load actually spend its time, and what
// does the proxy cost versus not proxying at all?" It measures:
//
//   1. DIRECT vs PROXIED loads of the same fixtures (localhost, unshaped)
//   2. per-request attribution inside the service worker (instrumented sw.js):
//      total handleFetch time vs transport time-to-headers per request
//   3. per-document client boot cost: the injected wasm-payload script,
//      atob + Uint8Array.from, sync WebAssembly.Module compile, all.js eval
//   4. a CDP trace of one proxied load (EvaluateScript/ParseHTML by URL)
//   5. the same comparison over a SHAPED link (60 ms RTT, 10 Mbit/s) - the
//      localhost numbers hide everything download-ordering related
//   6. repeat-visit behavior on a cacheable origin: the browser HTTP cache
//      works for direct loads and does nothing for proxied loads (responses
//      synthesized by a service worker are never HTTP-cached, and the engine
//      never uses the Cache API)
//   7. cold start breakdown (controller.init / SW install / transport / first nav)
//
//   node bottleneck/e2e-phases.mjs           (run from bench/)
//
// Results land in results/bottleneck-*.json; a summary prints to stdout.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
logging.set_level(logging.WARN);
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { pages, jsFiles, cssFiles, PNG } from "../e2e/fixtures.mjs";

const benchDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(benchDir, "..");

wisp.options.allow_loopback_ips = true;
wisp.options.allow_private_ips = true;

const PORTS = {
	origin: 4630, // no-store, unshaped (same conditions as e2e/run.mjs)
	originCache: 4631, // cacheable, shaped   (repeat-visit experiment)
	host: 4632, // instrumented sherpa host
	originShaped: 4633, // no-store, shaped   (realistic-network experiment)
};
const SHAPE = { latencyMs: 30, bps: 1_250_000 }; // ~60ms RTT, ~10 Mbit/s

// ---------------------------------------------------------------- fixtures
// big fixtures on top of the shared e2e set: a ~1 MiB real-minified JS bundle
// (six concatenated copies of the published scramjet.all.js IIFE - real
// minified code, deterministic) and a ~1.2 MiB HTML document.
const vendorJs = readFileSync(
	join(benchDir, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js"),
	"utf8"
);
const bigJs = Array(6).fill(vendorJs).join("\n;\n");
const bigHtml = (() => {
	const src = pages["/article.html"];
	const bodyStart = src.indexOf("<body>") + "<body>".length;
	const bodyEnd = src.indexOf("</body>");
	const body = src.slice(bodyStart, bodyEnd);

	return (
		src
			.slice(0, bodyStart)
			// pull the ~1 MiB minified bundle in as a real <script> so the
			// document exercises the oxc rewrite path on realistic payloads
			.replace(
				"</head>",
				`<script src="/big/bundle.js" defer></script></head>`
			) +
		Array(16).fill(body).join("\n") +
		src.slice(bodyEnd)
	);
})();

const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".png": "image/png",
	".wasm": "application/wasm",
	".map": "application/json",
	".json": "application/json",
};

// direct-load harness served BY the origin, so direct loads use the same
// iframe-navigation + timing-extraction code path as proxied loads
const directHarnessHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>direct</title></head><body>
<script>
${readFileSync(join(benchDir, "bottleneck/navigate.js"), "utf8")}
window.benchNavigate = makeNavigator((frame, url) => {
	frame.src = url;
});
window.benchReady = Promise.resolve(true);
</script></body></html>`;

function shapedSend(res, status, headers, body, shape) {
	const start = () => {
		res.writeHead(status, headers);
		if (!shape?.bps) return res.end(body);
		const chunk = Math.max(2048, Math.round(shape.bps * 0.016));
		let i = 0;
		const iv = setInterval(() => {
			const end = Math.min(body.length, i + chunk);
			res.write(body.subarray(i, end));
			i = end;
			if (i >= body.length) {
				clearInterval(iv);
				res.end();
			}
		}, 16);
	};
	if (shape?.latencyMs) setTimeout(start, shape.latencyMs);
	else start();
}

function startOrigin(port, { cacheable = false, shape = null } = {}) {
	const cc = cacheable ? "public, max-age=3600" : "no-store";
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		let body;
		let type = "text/html";

		if (path === "/bench-direct.html") {
			// the harness itself is never part of a measurement - send it plain
			res.writeHead(200, {
				"content-type": "text/html",
				"cache-control": "no-store",
			});

			return res.end(directHarnessHtml);
		} else if (pages[path]) body = pages[path];
		else if (path === "/big/page.html") body = bigHtml;
		else if (path === "/big/bundle.js")
			((body = bigJs), (type = "text/javascript"));
		else if (jsFiles[path])
			((body = jsFiles[path]), (type = "text/javascript"));
		else if (cssFiles[path]) ((body = cssFiles[path]), (type = "text/css"));
		else if (path.startsWith("/img/") && path.endsWith(".png"))
			((body = PNG), (type = "image/png"));
		else if (path.startsWith("/page/"))
			body = `<!DOCTYPE html><html><body><h1>page ${path}</h1></body></html>`;
		else {
			res.writeHead(404).end("not found");

			return;
		}
		const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
		shapedSend(
			res,
			200,
			{
				"content-type": type,
				"content-length": buf.length,
				"cache-control": cc,
			},
			buf,
			shape
		);
	});

	return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

// ------------------------------------------------------- instrumented host
// same shape as e2e/servers.mjs startHostServer, plus:
//  - sw.js wraps engine.fetch (total per-request time in the SW) and
//    engine.client.fetch (transport time-to-headers per upstream request)
//  - the harness drains those records over a MessageChannel (the harness
//    page itself is not SW-controlled, so a fetch would bypass the worker)
const ENGINE = {
	distDir: join(repoRoot, "dist"),
	prefix: "/proxied/",
};

function harnessHtml(flagsJson) {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>sherpa bottleneck</title></head>
<body>
<script src="/baremux/index.js" defer></script>
<script src="/engine/sherpa.all.js" defer></script>
<script>
${readFileSync(join(benchDir, "bottleneck/navigate.js"), "utf8")}
window.benchReady = (async () => {
	const marks = {};
	let t0 = performance.now();
	await new Promise((r) => addEventListener("load", r));
	marks.pageLoad = performance.now() - t0;
	const { SherpaController } = $sherpaLoadController();
	const controller = new SherpaController({
		prefix: "/proxied/",
		files: {
			wasm: "/engine/sherpa.wasm.wasm",
			all: "/engine/sherpa.all.js",
			sync: "/engine/sherpa.sync.js",
		},
		flags: ${flagsJson},
	});
	t0 = performance.now();
	await controller.init();
	marks.controllerInit = performance.now() - t0;
	t0 = performance.now();
	await navigator.serviceWorker.register("/sw.js");
	await navigator.serviceWorker.ready;
	marks.swInstall = performance.now() - t0;
	t0 = performance.now();
	const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
	await connection.setTransport("/epoxy/index.mjs", [{ wisp: "ws://" + location.host + "/wisp/" }]);
	marks.setTransport = performance.now() - t0;
	window.__controller = controller;
	window.__marks = marks;
	return marks;
})();

window.benchNavigate = makeNavigator((frame, url) => {
	window.__sherpaFrame.go(url);
}, () => {
	if (!window.__sherpaFrame) {
		const f = window.__controller.createFrame();
		f.frame.style.width = "1000px";
		f.frame.style.height = "800px";
		document.body.appendChild(f.frame);
		window.__sherpaFrame = f;
		return f.frame;
	}
	return window.__sherpaFrame.frame;
});

// drain the SW's timing records over a MessageChannel (the harness page
// itself is not controlled by the SW, so a fetch would bypass it)
window.benchTimings = async () => {
	const reg = await navigator.serviceWorker.ready;
	return new Promise((resolve) => {
		const ch = new MessageChannel();
		ch.port1.onmessage = (e) => resolve(e.data);
		reg.active.postMessage({ __benchTimings: true }, [ch.port2]);
	});
};

// per-document boot-cost microbenchmark; mirrors exactly what every proxied
// document pays: <script> with a ~712 KiB base64 body, then all.js whose
// module init runs Uint8Array.from(atob(WASM), cb), then (lazily, on first
// JS-rewrite need in the realm) a synchronous WebAssembly.Module compile.
window.benchBoot = async () => {
	const res = {};
	const buf = await (await fetch("/engine/sherpa.wasm.wasm")).arrayBuffer();
	const u8 = new Uint8Array(buf);
	let bin = "";
	for (let i = 0; i < u8.length; i += 8192)
		bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
	const b64 = btoa(bin);
	res.wasmBytes = u8.length;
	res.payloadChars = b64.length;

	let t0 = performance.now();
	const blob = new Blob(["self.__BOOT_WASM='" + b64 + "';"], { type: "text/javascript" });
	const burl = URL.createObjectURL(blob);
	await new Promise((r, j) => {
		const s = document.createElement("script");
		s.src = burl; s.onload = r; s.onerror = j;
		document.head.append(s);
	});
	res.payloadEvalMs = performance.now() - t0;

	t0 = performance.now();
	const bytes = Uint8Array.from(atob(self.__BOOT_WASM), (c) => c.charCodeAt(0));
	res.atobFromMs = performance.now() - t0;

	t0 = performance.now();
	new WebAssembly.Module(bytes);
	res.moduleCompileMs = performance.now() - t0;

	// all.js parse+execute in a fresh realm with WASM present (per-document cost)
	const fr = document.createElement("iframe");
	document.body.append(fr);
	fr.contentWindow.WASM = self.__BOOT_WASM;
	t0 = performance.now();
	await new Promise((r, j) => {
		const s = fr.contentDocument.createElement("script");
		s.src = "/engine/sherpa.all.js"; s.onload = r; s.onerror = j;
		fr.contentDocument.head.append(s);
	});
	res.allJsEvalMs = performance.now() - t0;
	fr.remove();
	return res;
};
</script>
</body></html>`;
}

const SW_JS = `importScripts("/engine/sherpa.all.js");
const { SherpaServiceWorker } = $sherpaLoadWorker();
const engine = new SherpaServiceWorker();
let recs = [];
let transportWrapped = false;
function wrapTransport() {
	if (transportWrapped) return;
	transportWrapped = true;
	const real = engine.client.fetch.bind(engine.client);
	engine.client.fetch = async function (url, init) {
		const rec = { kind: "transport", url: String(url), start: performance.now() };
		recs.push(rec);
		const resp = await real(url, init);
		rec.headersMs = performance.now() - rec.start;
		rec.status = resp.status;
		rec.contentLength = Number(resp.headers.get("content-length")) || null;
		return resp;
	};
}
self.addEventListener("message", (e) => {
	if (e.data && e.data.__benchTimings) {
		const out = recs;
		recs = [];
		e.ports[0].postMessage(out);
	}
});
async function handleRequest(event) {
	await engine.loadConfig();
	wrapTransport();
	if (engine.route(event)) {
		const rec = {
			kind: "sw",
			url: event.request.url,
			dest: event.request.destination,
			start: performance.now(),
		};
		recs.push(rec);
		const resp = await engine.fetch(event);
		rec.totalMs = performance.now() - rec.start;
		rec.status = resp.status;
		return resp;
	}
	return fetch(event.request);
}
self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});`;

function startHost() {
	const server = createServer((req, res) => {
		const [path, query] = req.url.split("?");
		const send = (body, type, extra = {}) => {
			res.writeHead(200, {
				"content-type": type,
				"cross-origin-opener-policy": "same-origin",
				"cross-origin-embedder-policy": "require-corp",
				"cross-origin-resource-policy": "cross-origin",
				...extra,
			});
			res.end(body);
		};

		if (path === "/" || path === "/bench.html") {
			const params = new URLSearchParams(query);
			const flags = params.get("flags") || "{}";

			return send(harnessHtml(flags), "text/html", {
				"cache-control": "no-store",
			});
		}
		if (path === "/sw.js")
			return send(SW_JS, "text/javascript", { "cache-control": "no-store" });

		for (const [route, dir] of [
			["/engine/", ENGINE.distDir],
			["/baremux/", baremuxPath],
			["/epoxy/", epoxyPath],
		]) {
			if (path.startsWith(route)) {
				const file = join(dir, path.slice(route.length));
				if (!file.startsWith(dir)) break;
				try {
					const ext = file.slice(file.lastIndexOf("."));

					// engine/transport files cacheable, like a production deploy
					return send(
						readFileSync(file),
						MIME[ext] ?? "application/octet-stream",
						{
							"cache-control": "public, max-age=3600",
						}
					);
				} catch {
					break;
				}
			}
		}

		res.writeHead(404, {
			"cross-origin-opener-policy": "same-origin",
			"cross-origin-embedder-policy": "require-corp",
		});
		res.end("not found");
	});
	server.on("upgrade", (req, socket, head) => {
		if (req.url.startsWith("/wisp/")) wisp.routeRequest(req, socket, head);
		else socket.destroy();
	});

	return new Promise((r) =>
		server.listen(PORTS.host, "127.0.0.1", () => r(server))
	);
}

// ------------------------------------------------------------------ driver
const stats = (xs) => {
	const s = [...xs].sort((a, b) => a - b);

	return {
		n: s.length,
		median: s[Math.floor(s.length / 2)],
		min: s[0],
		max: s[s.length - 1],
	};
};
const med = (xs) => stats(xs).median;
const ms = (x) => (x == null ? "      - " : x.toFixed(1).padStart(7) + "ms");
const kib = (x) => (x / 1024).toFixed(0).padStart(6) + " KiB";

const servers = [
	await startOrigin(PORTS.origin),
	await startOrigin(PORTS.originCache, { cacheable: true, shape: SHAPE }),
	await startOrigin(PORTS.originShaped, { shape: SHAPE }),
	await startHost(),
];

const browser = await chromium.launch({
	executablePath:
		process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium",
	args: ["--enable-features=SharedArrayBuffer"],
});

async function proxiedHarness(flags = {}) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on("pageerror", (e) => console.error("[pageerror]", e.message));
	await page.goto(
		`http://127.0.0.1:${PORTS.host}/bench.html?flags=${encodeURIComponent(JSON.stringify(flags))}`,
		{ waitUntil: "load" }
	);
	await page.waitForFunction(() => window.benchReady !== undefined);
	const marks = await page.evaluate(() => window.benchReady);

	return { context, page, marks };
}

async function directHarness(originPort) {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on("pageerror", (e) => console.error("[direct pageerror]", e.message));
	await page.goto(`http://127.0.0.1:${originPort}/bench-direct.html`, {
		waitUntil: "load",
	});

	return { context, page };
}

async function nav(page, url) {
	try {
		return await page.evaluate((u) => window.benchNavigate(u), url);
	} catch (e) {
		console.error(`retrying ${url}: ${e.message.split("\n")[0]}`);

		return await page.evaluate((u) => window.benchNavigate(u), url);
	}
}

const results = {};
const PAGES = ["/landing.html", "/article.html", "/app.html", "/gallery.html"];
const ORIGIN = `http://127.0.0.1:${PORTS.origin}`;
const ORIGIN_SHAPED = `http://127.0.0.1:${PORTS.originShaped}`;
const ORIGIN_CACHE = `http://127.0.0.1:${PORTS.originCache}`;

// ---- 1+2: unshaped direct vs proxied, with SW attribution -----------------
console.log("\n== unshaped localhost: direct vs proxied (warm, n=8) ==");
{
	const ROUNDS = 8;
	const direct = {};
	{
		const { context, page } = await directHarness(PORTS.origin);
		for (const p of PAGES) await nav(page, ORIGIN + p); // warmup
		for (let i = 0; i < ROUNDS; i++)
			for (const p of PAGES) {
				(direct[p] ??= []).push(await nav(page, ORIGIN + p));
			}
		await context.close();
	}

	const proxied = {};
	const swRecords = {};
	{
		const { context, page } = await proxiedHarness();
		for (const p of PAGES) await nav(page, ORIGIN + p); // warmup
		await page.evaluate(() => window.benchTimings()); // drain warmup records
		for (let i = 0; i < ROUNDS; i++)
			for (const p of PAGES) {
				(proxied[p] ??= []).push(await nav(page, ORIGIN + p));
				(swRecords[p] ??= []).push(
					await page.evaluate(() => window.benchTimings())
				);
			}

		// boot micro + big-fixture differential on the same warm harness
		results.boot = [];
		for (let i = 0; i < 5; i++)
			results.boot.push(await page.evaluate(() => window.benchBoot()));

		console.log(
			"\n== big page (~1.2 MiB HTML + ~1 MiB minified JS), warm proxy (n=5) =="
		);
		const big = { "/big/page.html": [], timings: [] };
		for (let i = 0; i < 5; i++) {
			big["/big/page.html"].push(await nav(page, ORIGIN + "/big/page.html"));
			big.timings.push(await page.evaluate(() => window.benchTimings()));
		}
		results.big = big;
		for (const cls of ["document", "script"]) {
			const totals = [];
			const transports = [];
			for (const recs of big.timings) {
				for (const r of recs.filter(
					(r) =>
						r.kind === "sw" &&
						(cls === "document"
							? ["document", "iframe"].includes(r.dest)
							: r.dest === cls) &&
						decodeURIComponent(r.url).includes("/big/")
				)) {
					totals.push(r.totalMs);
					const t = recs.find(
						(t) =>
							t.kind === "transport" &&
							t.start >= r.start &&
							t.start <= r.start + r.totalMs
					);
					if (t) transports.push(t.headersMs);
				}
			}
			if (totals.length)
				console.log(
					`  ${cls.padEnd(9)} sw total ${ms(med(totals))}   transport ${ms(transports.length ? med(transports) : null)}   engine+buffer ${ms(transports.length ? med(totals) - med(transports) : null)}`
				);
		}
		await context.close();
	}

	results.unshaped = { direct: {}, proxied: {}, sw: swRecords };
	for (const p of PAGES) {
		const d = direct[p].map((r) => r.total);
		const x = proxied[p].map((r) => r.total);
		results.unshaped.direct[p] = direct[p];
		results.unshaped.proxied[p] = proxied[p];
		console.log(
			`${p.padEnd(15)} direct ${ms(med(d))}   proxied ${ms(med(x))}   overhead ${(med(x) / med(d)).toFixed(1)}x`
		);
	}

	// per-request attribution inside the SW, per destination class: how much
	// of each request is transport (time-to-headers over wisp/epoxy) vs the
	// engine itself (security emulation + body buffering + rewriting)
	console.log(
		"\n== SW per-request attribution (medians per page load, warm) =="
	);
	console.log(
		"page             class      n/load   sw total   transport   engine+buffer"
	);
	for (const p of PAGES) {
		const perClass = {};
		for (const roundRecs of swRecords[p]) {
			const sws = roundRecs.filter((r) => r.kind === "sw");
			const trs = roundRecs.filter((r) => r.kind === "transport");
			for (const r of sws) {
				// match this SW record to its transport fetch by time window
				const t = trs.find(
					(t) => t.start >= r.start && t.start <= r.start + (r.totalMs ?? 0)
				);
				if (t) t.used = true;
				const cls = ["document", "iframe"].includes(r.dest)
					? "document"
					: r.dest || "other";
				const c = (perClass[cls] ??= { count: [], total: [], transport: [] });
				c.count.push(1);
				c.total.push(r.totalMs ?? 0);
				c.transport.push(t?.headersMs ?? null);
			}
		}
		for (const [cls, c] of Object.entries(perClass)) {
			const perLoad = c.total.length / swRecords[p].length;
			const t = c.transport.filter((x) => x != null);
			const swMed = med(c.total);
			const trMed = t.length ? med(t) : null;
			console.log(
				`${p.padEnd(16)} ${cls.padEnd(10)} ${perLoad.toFixed(1).padStart(6)}   ${ms(swMed)}   ${ms(trMed)}   ${ms(trMed != null ? swMed - trMed : null)}`
			);
		}
	}

	console.log("\n== per-document client boot cost (medians of 5) ==");
	for (const k of [
		"payloadEvalMs",
		"atobFromMs",
		"moduleCompileMs",
		"allJsEvalMs",
	]) {
		console.log(`${k.padEnd(18)} ${ms(med(results.boot.map((b) => b[k])))}`);
	}
	console.log(
		`(wasm ${kib(results.boot[0].wasmBytes)}, base64 payload ${kib(results.boot[0].payloadChars)})`
	);
}

// ---- 3b: the default `sourcemaps` flag, A/B --------------------------------
// sourcemaps defaults ON in SherpaController. In the SW rewrite path it
// serializes every script's rewrite map as a decimal array literal prepended
// to the delivered script; the client then parses + registers it.
console.log("\n== flags.sourcemaps A/B (proxied, warm, n=6) ==");
{
	const AB = {};
	for (const sourcemaps of [true, false]) {
		const { context, page } = await proxiedHarness({ sourcemaps });
		for (const p of ["/article.html", "/app.html"]) await nav(page, ORIGIN + p);
		for (let i = 0; i < 6; i++)
			for (const p of ["/article.html", "/app.html"])
				((AB[p] ??= {})[sourcemaps] ??= []).push(
					(await nav(page, ORIGIN + p)).total
				);
		await context.close();
	}
	results.sourcemapsAB = AB;
	for (const [p, r] of Object.entries(AB))
		console.log(
			`${p.padEnd(15)} sourcemaps ON ${ms(med(r.true))}   OFF ${ms(med(r.false))}`
		);
}

// ---- 4: CDP trace of one proxied load -------------------------------------
console.log("\n== CDP trace of one proxied landing.html load ==");
{
	const { context, page } = await proxiedHarness();
	await nav(page, ORIGIN + "/landing.html"); // warm the SW + engine
	await browser.startTracing(page, {
		categories: [
			"devtools.timeline",
			"v8",
			"disabled-by-default-devtools.timeline",
		],
	});
	await nav(page, ORIGIN + "/article.html");
	const buf = await browser.stopTracing();
	await context.close();

	const trace = JSON.parse(buf.toString());
	const byUrl = new Map();
	for (const e of trace.traceEvents ?? trace) {
		if (!e.dur) continue;
		if (!["EvaluateScript", "ParseHTML", "v8.compile"].includes(e.name))
			continue;
		const url =
			e.args?.data?.url ??
			e.args?.data?.fileName ??
			e.args?.beginData?.url ??
			"?";
		const k = `${e.name} ${url.length > 90 ? url.slice(0, 87) + "..." : url}`;
		byUrl.set(k, (byUrl.get(k) ?? 0) + e.dur / 1000);
	}
	results.trace = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
	for (const [k, v] of results.trace) console.log(`${ms(v)}  ${k}`);
}

// ---- 5: shaped network, direct vs proxied ---------------------------------
console.log(
	`\n== shaped link (${SHAPE.latencyMs * 2}ms RTT, ${((SHAPE.bps * 8) / 1e6).toFixed(0)} Mbit/s): direct vs proxied (n=4) ==`
);
{
	const SPAGES = ["/landing.html", "/article.html", "/big/page.html"];
	const direct = {};
	{
		const { context, page } = await directHarness(PORTS.originShaped);
		for (const p of SPAGES) await nav(page, ORIGIN_SHAPED + p);
		for (let i = 0; i < 4; i++)
			for (const p of SPAGES)
				(direct[p] ??= []).push(await nav(page, ORIGIN_SHAPED + p));
		await context.close();
	}
	const proxied = {};
	{
		const { context, page } = await proxiedHarness();
		for (const p of SPAGES) await nav(page, ORIGIN_SHAPED + p);
		for (let i = 0; i < 4; i++)
			for (const p of SPAGES)
				(proxied[p] ??= []).push(await nav(page, ORIGIN_SHAPED + p));
		await context.close();
	}
	results.shaped = { direct, proxied };
	for (const p of SPAGES) {
		const dl = med(direct[p].map((r) => r.total));
		const dt = med(direct[p].map((r) => r.nav?.responseStart ?? 0));
		const xl = med(proxied[p].map((r) => r.total));
		const xt = med(proxied[p].map((r) => r.nav?.responseStart ?? 0));
		console.log(
			`${p.padEnd(16)} direct load ${ms(dl)} (docTTFB ${ms(dt)})   proxied load ${ms(xl)} (docTTFB ${ms(xt)})`
		);
	}
}

// ---- 6: repeat visit on a cacheable origin (shaped) ------------------------
console.log("\n== repeat visit, cacheable origin over shaped link ==");
{
	const P = "/article.html";
	const dRuns = { first: [], second: [] };
	// fresh context per pair so every "first" is a genuinely cold HTTP cache
	for (let i = 0; i < 3; i++) {
		const { context, page } = await directHarness(PORTS.originCache);
		dRuns.first.push(await nav(page, ORIGIN_CACHE + P));
		await page.evaluate(() => window.benchBlank());
		dRuns.second.push(await nav(page, ORIGIN_CACHE + P));
		await context.close();
	}
	const xRuns = { first: [], second: [] };
	{
		const { context, page } = await proxiedHarness();
		for (let i = 0; i < 3; i++) {
			xRuns.first.push(await nav(page, ORIGIN_CACHE + P));
			await page.evaluate(() => window.benchBlank());
			xRuns.second.push(await nav(page, ORIGIN_CACHE + P));
			xRuns.secondTimings = await page.evaluate(() => window.benchTimings());
		}
		await context.close();
	}
	results.repeat = { direct: dRuns, proxied: xRuns };
	const sumTransfer = (r) =>
		(r.resources ?? []).reduce((a, x) => a + (x.transferSize || 0), 0) +
		(r.nav?.transferSize || 0);
	console.log(
		`direct : 1st ${ms(med(dRuns.first.map((r) => r.total)))} (${kib(med(dRuns.first.map(sumTransfer)))} wire)   2nd ${ms(med(dRuns.second.map((r) => r.total)))} (${kib(med(dRuns.second.map(sumTransfer)))} wire)`
	);
	console.log(
		`proxied: 1st ${ms(med(xRuns.first.map((r) => r.total)))}   2nd ${ms(med(xRuns.second.map((r) => r.total)))} (re-fetches + re-rewrites everything)`
	);
}

// ---- 7: cold start breakdown ----------------------------------------------
console.log("\n== cold start breakdown (fresh context each, n=4) ==");
{
	const cold = [];
	for (let i = 0; i < 4; i++) {
		const t0 = Date.now();
		const { context, page, marks } = await proxiedHarness();
		const first = await nav(page, ORIGIN + "/landing.html");
		cold.push({ ...marks, firstNav: first.total, wall: Date.now() - t0 });
		await context.close();
	}
	results.cold = cold;
	for (const k of [
		"pageLoad",
		"controllerInit",
		"swInstall",
		"setTransport",
		"firstNav",
		"wall",
	])
		console.log(`${k.padEnd(15)} ${ms(med(cold.map((c) => c[k])))}`);
}

mkdirSync(join(benchDir, "results"), { recursive: true });
const file = join(
	benchDir,
	"results",
	`bottleneck-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
writeFileSync(
	file,
	JSON.stringify({ date: new Date().toISOString(), SHAPE, results }, null, "\t")
);
console.log(`\nwrote ${file}`);

await browser.close();
for (const s of servers) s.close();
process.exit(0);
