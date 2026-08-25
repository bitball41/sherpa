// End-to-end check of the service worker's rewritten-response cache.
//
// The other harnesses in here measure throughput. This one asserts behavior,
// in a real browser, through the real pipeline (service worker + WASM rewriter
// + bare-mux/epoxy over wisp): a second visit to the same page must serve its
// subresources out of the Cache API instead of going back to the origin, and
// the page must still work.
//
//   cd bench && npm i && node cache-e2e.mjs
//
// Chromium comes from playwright's usual lookup; set SHERPA_CHROMIUM to point
// at a specific binary (needed when the installed browser build does not match
// what this directory's playwright pins).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startHostServer, HOST_PORTS } from "./e2e/servers.mjs";

const benchDir = dirname(fileURLToPath(import.meta.url));
const ORIGIN_PORT = 4655;
const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const HOST = `http://127.0.0.1:${HOST_PORTS.sherpa}`;

// ------------------------------------------------------------------ origin
// Counts every hit so a cache hit is directly observable, and serves one
// resource of each policy Sherpa has to get right.
const hits = Object.create(null);
const conditional = Object.create(null);

// A real minified bundle (the published scramjet.all.js, ~180 KiB) stands in
// for the framework bundle every real page ships. Rewriting it is the work a
// cache hit skips, and without something of that weight the A/B below measures
// iframe navigation overhead instead of the engine.
const VENDOR_JS = readFileSync(
	join(benchDir, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js"),
	"utf8"
);

const PAGE = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/immutable.css">
</head><body>
<h1 id="title">cache fixture</h1>
<img src="/asset.png" width="4" height="4">
<script src="/vendor.js"></script>
<script src="/immutable.js"></script>
<script src="/validated.js"></script>
</body></html>`;

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mNk+M9QzzCKRsEoGgWjAAB4iwP9k4S4CAAAAABJRU5ErkJggg==",
	"base64"
);

const VALIDATED_ETAG = '"validated-v1"';

// Link shaping. Localhost has no latency and effectively infinite bandwidth,
// which is precisely the cost a cache hit removes - unshaped, the numbers say
// nothing about what caching is worth. Defaults to ~60 ms RTT / 10 Mbit/s;
// SHERPA_SHAPE=0 turns it off.
const SHAPE =
	process.env.SHERPA_SHAPE === "0"
		? null
		: { latencyMs: 30, bytesPerSecond: 1_250_000 };

function startOrigin() {
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		hits[path] = (hits[path] || 0) + 1;

		const send = (body, type, headers = {}) => {
			const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
			const write = () => {
				res.writeHead(200, {
					"content-type": type,
					"content-length": buffer.length,
					...headers,
				});
				if (!SHAPE) return res.end(buffer);

				// Meter the body out at the configured bandwidth. A cache hit skips
				// both the round trip above and all of this.
				const chunk = 16 * 1024;
				let offset = 0;
				const pump = () => {
					if (offset >= buffer.length) return res.end();
					const slice = buffer.subarray(offset, offset + chunk);
					offset += slice.length;
					res.write(slice);
					setTimeout(pump, (slice.length / SHAPE.bytesPerSecond) * 1000);
				};
				pump();
			};

			if (SHAPE) setTimeout(write, SHAPE.latencyMs);
			else write();
		};

		// Every page of the "site" is a distinct document referencing the same
		// subresources. Navigating the same iframe to the same URL over and over
		// would let Chromium's own in-renderer memory cache serve the
		// subresources without ever consulting the service worker, which would
		// make a cache hit indistinguishable from a browser hit - and is not what
		// repeat browsing looks like anyway. Warm assets shared across the pages
		// of a site are.
		if (path.startsWith("/page/"))
			// documents are deliberately never cached by Sherpa
			return send(PAGE, "text/html", { "cache-control": "no-store" });

		if (path === "/immutable.css")
			return send("#title { color: rgb(1, 2, 3); }", "text/css", {
				"cache-control": "max-age=600",
			});

		if (path === "/immutable.js")
			return send(
				"document.getElementById('title').dataset.immutable = 'ran';",
				"text/javascript",
				{ "cache-control": "max-age=600" }
			);

		if (path === "/validated.js") {
			// must-revalidate every time, but revalidation is cheap: a 304 has to
			// replay the stored *rewritten* script rather than re-download it
			if (req.headers["if-none-match"] === VALIDATED_ETAG) {
				conditional[path] = (conditional[path] || 0) + 1;
				const reply = () => {
					res.writeHead(304, {
						etag: VALIDATED_ETAG,
						"cache-control": "no-cache",
					});
					res.end();
				};
				if (SHAPE) setTimeout(reply, SHAPE.latencyMs);
				else reply();

				return;
			}

			return send(
				"document.getElementById('title').dataset.validated = 'ran';",
				"text/javascript",
				{ "cache-control": "no-cache", etag: VALIDATED_ETAG }
			);
		}

		if (path === "/vendor.js")
			return send(VENDOR_JS, "text/javascript", {
				"cache-control": "max-age=600",
			});

		if (path === "/asset.png")
			return send(PNG, "image/png", { "cache-control": "max-age=600" });

		res.writeHead(404).end("not found");
	});

	return new Promise((resolve) =>
		server.listen(ORIGIN_PORT, "127.0.0.1", () => resolve(server))
	);
}

function snapshot() {
	return JSON.parse(JSON.stringify({ hits, conditional }));
}

function reset() {
	for (const key of Object.keys(hits)) delete hits[key];
	for (const key of Object.keys(conditional)) delete conditional[key];
}

// -------------------------------------------------------------------- run
const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok    ${label}`);
	} else {
		console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
		failures.push(label);
	}
}

const origin = await startOrigin();
const host = await startHostServer("sherpa");
const browser = await chromium.launch({
	executablePath: process.env.SHERPA_CHROMIUM || undefined,
	args: ["--no-sandbox"],
});
// One context, several pages. A browser has caches of its own: responses a
// service worker synthesizes are never written to the disk HTTP cache, but the
// *renderer's* in-memory cache holds them for the life of the process, so a
// repeat navigation inside one page proves nothing about Sherpa's cache.
// Closing the page tears that renderer down; keeping the context keeps the
// origin's Cache API, IndexedDB and service worker registration. Each phase
// below therefore runs in a fresh page, and only the engine's own cache
// survives between them.
const context = await browser.newContext();

async function openHarness() {
	const page = await context.newPage();
	page.on("pageerror", (error) => console.log("  page error:", error.message));
	await page.goto(HOST, { waitUntil: "load" });
	await page.evaluate(() => window.benchReady);

	return page;
}

const readMarkers = (page) =>
	page.evaluate(() => {
		const frame = document.querySelector("iframe");
		const title = frame.contentDocument.getElementById("title");

		return {
			immutable: title.dataset.immutable || null,
			validated: title.dataset.validated || null,
			color: frame.contentWindow.getComputedStyle(title).color,
		};
	});

const visit = (page, path) =>
	page.evaluate((url) => window.benchNavigate(url), `${ORIGIN}${path}`);

try {
	// ------------------------------------------- first visit (populates cache)
	let page = await openHarness();

	// The page that registers a service worker is not controlled by it until the
	// next navigation (nothing calls `clients.claim()` here, as in most
	// integrations), so `navigator.serviceWorker.controller` is null on this
	// first load. That is the case `SherpaController.notifyWorker` exists for:
	// posting only to `controller` dropped every runtime config update here.
	console.log(
		"first page is controlled by the worker:",
		await page.evaluate(() => navigator.serviceWorker.controller !== null)
	);

	reset();
	const firstMs = await visit(page, "/page/1.html");
	await page.waitForTimeout(500);
	const first = snapshot();
	const firstMarkers = await readMarkers(page);

	console.log("first visit:", JSON.stringify(first.hits));
	check("first visit fetches the document", first.hits["/page/1.html"] === 1);
	check("first visit fetches the script", first.hits["/immutable.js"] === 1);
	check(
		"first visit fetches the stylesheet",
		first.hits["/immutable.css"] === 1
	);
	check("first visit fetches the image", first.hits["/asset.png"] === 1);
	check(
		"first visit fetches the vendor bundle",
		first.hits["/vendor.js"] === 1
	);
	check("the proxied script ran", firstMarkers.immutable === "ran");
	check("the revalidated script ran", firstMarkers.validated === "ran");
	check(
		"the proxied stylesheet applied",
		firstMarkers.color === "rgb(1, 2, 3)",
		firstMarkers.color
	);

	const buckets = await page.evaluate(async () => {
		const names = await caches.keys();

		return names.filter((name) => name.startsWith("scramjet$response$"));
	});
	check(
		"the engine wrote exactly one response-cache bucket",
		buckets.length === 1,
		JSON.stringify(buckets)
	);

	// -------------------------------- second visit, new renderer, new document
	await page.close();
	page = await openHarness();
	reset();
	const secondMs = await visit(page, "/page/2.html");
	await page.waitForTimeout(500);
	const second = snapshot();
	const secondMarkers = await readMarkers(page);

	console.log("second visit:", JSON.stringify(second.hits));
	check(
		"the document is re-fetched (documents are never cached)",
		second.hits["/page/2.html"] === 1,
		String(second.hits["/page/2.html"])
	);
	check(
		"the fresh script is served from cache",
		!second.hits["/immutable.js"],
		`${second.hits["/immutable.js"] || 0} origin hits`
	);
	check(
		"the fresh stylesheet is served from cache",
		!second.hits["/immutable.css"],
		`${second.hits["/immutable.css"] || 0} origin hits`
	);
	check(
		"the fresh image is served from cache",
		!second.hits["/asset.png"],
		`${second.hits["/asset.png"] || 0} origin hits`
	);
	check(
		"the vendor bundle is served from cache",
		!second.hits["/vendor.js"],
		`${second.hits["/vendor.js"] || 0} origin hits`
	);
	check(
		"the no-cache script is revalidated, not re-downloaded",
		second.conditional["/validated.js"] === 1,
		`${second.conditional["/validated.js"] || 0} conditional requests`
	);
	check("the cached script still ran", secondMarkers.immutable === "ran");
	check("the revalidated script still ran", secondMarkers.validated === "ran");
	check(
		"the cached stylesheet still applied",
		secondMarkers.color === "rgb(1, 2, 3)",
		secondMarkers.color
	);

	// ------------------------------------------------- attribution: whose hit?
	// Turn the engine's cache off and repeat the exercise in another fresh page.
	// If the requests come back, the zero-hit visit above really was answered by
	// the engine, not by anything the browser does on its own. (Deleting the
	// bucket would not prove it: a `Cache` handle the worker already holds keeps
	// working after `caches.delete`, by design.)
	await page.close();

	page = await openHarness();
	// After the harness page's own `controller.init()`, which re-persists the
	// default configuration - so the flag has to be flipped from here.
	await page.evaluate(() =>
		window.__controller.modifyConfig({ flags: { responseCache: false } })
	);
	reset();
	await visit(page, "/page/3.html");
	await page.waitForTimeout(500);
	const disabled = snapshot();
	const disabledMarkers = await readMarkers(page);

	console.log("with responseCache off:", JSON.stringify(disabled.hits));
	check(
		"turning the cache off brings every subresource request back",
		disabled.hits["/vendor.js"] === 1 &&
			disabled.hits["/immutable.js"] === 1 &&
			disabled.hits["/immutable.css"] === 1 &&
			disabled.hits["/asset.png"] === 1,
		"if these stay at zero, something other than the engine was serving them"
	);
	check(
		"the page still works with the cache off",
		disabledMarkers.immutable === "ran" &&
			disabledMarkers.color === "rgb(1, 2, 3)"
	);

	// ------------------------------------------------------------ A/B timing
	// Clean comparison: every sample is the first proxied navigation of a
	// freshly opened page, so each pays the same per-page setup and the only
	// difference is whether the engine may reuse what it already rewrote. A
	// fresh page each time is what keeps the renderer's own memory cache out of
	// the numbers.
	await page.close();

	const samples = { on: [], off: [] };
	let pageCounter = 200;
	for (let round = 0; round < 3; round++) {
		for (const enabled of [false, true]) {
			// eslint-disable-next-line no-await-in-loop
			const sample = await openHarness();
			// eslint-disable-next-line no-await-in-loop
			await sample.evaluate(
				(on) =>
					window.__controller.modifyConfig({ flags: { responseCache: on } }),
				enabled
			);
			// eslint-disable-next-line no-await-in-loop
			const ms = await visit(sample, `/page/${pageCounter++}.html`);
			samples[enabled ? "on" : "off"].push(ms);
			// eslint-disable-next-line no-await-in-loop
			await sample.close();
		}
	}

	const median = (values) =>
		[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
	const off = median(samples.off);
	const on = median(samples.on);
	console.log("\nfirst proxied navigation of a fresh page:");
	console.log(
		`  responseCache off: median ${off.toFixed(1)} ms  [${samples.off
			.map((v) => v.toFixed(0))
			.join(", ")}]`
	);
	console.log(
		`  responseCache on : median ${on.toFixed(1)} ms  [${samples.on
			.map((v) => v.toFixed(0))
			.join(", ")}]`
	);
	console.log(
		`  ${(off / on).toFixed(2)}x` +
			(SHAPE
				? ` over a shaped link (${SHAPE.latencyMs * 2} ms RTT, ${(
						(SHAPE.bytesPerSecond * 8) /
						1e6
					).toFixed(0)} Mbit/s)`
				: " against an unshaped localhost origin, where the download a hit removes is free")
	);
	console.log(
		`  (cold first-ever navigation for reference: ${firstMs.toFixed(1)} ms; ` +
			`warm-cache repeat: ${secondMs.toFixed(1)} ms)`
	);
} finally {
	await browser.close();
	host.close();
	origin.close();
}

if (failures.length) {
	console.log(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log("\nall cache checks passed");
