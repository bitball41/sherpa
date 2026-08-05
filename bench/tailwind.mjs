// Drives the *real* @tailwindcss/browser build through the whole Sherpa
// pipeline: Tailwind reads its input out of a <style type="text/tailwindcss">,
// compiles utilities at runtime by watching the DOM, and injects the result as
// a stylesheet. Serving it from the fixture origin keeps the run hermetic.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
	startHostServer,
	ORIGIN_PORT,
	HOST_PORT,
} from "../tests/behavior/servers.mjs";

const benchDir = dirname(fileURLToPath(import.meta.url));
const TAILWIND = readFileSync(
	join(benchDir, "node_modules/@tailwindcss/browser/dist/index.global.js"),
	"utf8"
);
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64"
);

const originHits = [];

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>tailwind</title>
<style type="text/tailwindcss">
@import "tailwindcss";
@theme {
	--color-brand: oklch(0.7 0.15 250);
}
@layer components {
	.hero {
		background-image: url("/img/hero.png");
	}
}
</style>
<script src="/tailwind.js"></script>
</head>
<body>
<div id="box" class="bg-red-500 p-4 text-brand"></div>
<div id="hero" class="hero w-4 h-4"></div>
<script>
window.__done = false;
(async () => {
	const out = {};
	// Tailwind compiles on DOM ready and on mutation; give it a beat.
	await new Promise((r) => setTimeout(r, 1500));
	const box = getComputedStyle(document.getElementById("box"));
	out.background = box.backgroundColor;
	out.padding = box.padding;
	out.color = box.color;
	out.hero = getComputedStyle(document.getElementById("hero")).backgroundImage;
	out.sheets = document.styleSheets.length;
	out.tailwindSource = (document.querySelector('style[type="text/tailwindcss"]') || {}).textContent;
	window.__out = out;
	window.__done = true;
})();
</script>
</body></html>`;

function startOrigin() {
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		originHits.push(path);
		if (path === "/tw.html")
			return res
				.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				})
				.end(PAGE);
		if (path === "/tailwind.js")
			return res
				.writeHead(200, {
					"content-type": "text/javascript",
					"cache-control": "no-store",
				})
				.end(TAILWIND);
		if (path.endsWith(".png"))
			return res
				.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "no-store",
				})
				.end(PNG);
		res.writeHead(404, { "content-type": "text/plain" }).end("nope");
	});

	return new Promise((r) =>
		server.listen(ORIGIN_PORT, "127.0.0.1", () => r(server))
	);
}

const proxyHits = [];
let exitCode = 1;
const servers = [await startOrigin(), await startHostServer()];
const browser = await chromium.launch({
	executablePath: process.env.SHERPA_CHROMIUM || undefined,
	args: ["--enable-features=SharedArrayBuffer"],
});

try {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errs = [];
	page.on("pageerror", (e) => errs.push("pageerror: " + e));
	page.on("console", (m) => {
		if (m.type() === "error") errs.push("console: " + m.text());
	});
	page.on("response", (r) => {
		const u = r.url();
		if (u.includes("/img/") || u.includes("hero") || r.status() >= 400)
			proxyHits.push(r.status() + " " + u);
	});

	await page.goto(`http://127.0.0.1:${HOST_PORT}/harness.html`);
	await page.evaluate(() => window.harnessReady);
	const href = await page.evaluate(
		(url) => window.harnessNavigate(url),
		`http://127.0.0.1:${ORIGIN_PORT}/tw.html`
	);
	const frame = page
		.frames()
		.find((f) => f !== page.mainFrame() && f.url() === href);
	if (!frame) throw new Error("no proxied frame");
	await frame.waitForFunction(() => window.__done === true, null, {
		timeout: 40000,
	});
	const out = await frame.evaluate(() => window.__out);

	const checks = [];
	const expect = (name, actual, ok, detail) =>
		checks.push({ name, ok, detail: detail ?? String(actual) });

	// utilities compiled from classes Tailwind found by scanning the DOM
	expect(
		"bg-red-500 compiled",
		out.background,
		/^(oklch|rgb)\(/.test(out.background)
	);
	expect("p-4 compiled", out.padding, out.padding === "16px");
	// a variable declared in the page's own @theme block
	expect(
		"@theme --color-brand applied",
		out.color,
		out.color.replace(/\s+/g, "") === "oklch(0.70.15250)"
	);
	// a url() the page wrote in @layer components, which has to come back proxied
	expect(
		"url() in the page's own css is proxied",
		out.hero,
		out.hero.includes("/proxied/") &&
			out.hero.includes(encodeURIComponent("/img/hero.png"))
	);
	// and the image really was fetched from the site, not from the proxy host
	expect(
		"the image reached the site's origin",
		originHits.join(","),
		originHits.includes("/img/hero.png")
	);
	// the tailwind source the page reads back must be byte-identical: rewriting it
	// turns `@import "tailwindcss"` into a url Tailwind cannot resolve
	expect(
		"the tailwindcss input is preserved verbatim",
		"",
		String(out.tailwindSource).includes('@import "tailwindcss";'),
		JSON.stringify(String(out.tailwindSource).trim().slice(0, 40))
	);

	for (const c of checks)
		console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}  ->  ${c.detail}`);
	const failed = checks.filter((c) => !c.ok).length;
	console.log(
		`\n${checks.length - failed}/${checks.length} tailwind checks passed through the proxy`
	);
	if (errs.length)
		console.log("\npage errors:\n" + errs.slice(0, 8).join("\n"));
	exitCode = failed ? 1 : 0;
} finally {
	await browser.close();
	for (const s of servers) s.close();
	process.exit(exitCode);
}
