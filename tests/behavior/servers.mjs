// A local fixture origin and a local Sherpa proxy host, so the behavior suite
// drives the real shipped pipeline - service worker, WASM rewriter, bare-mux
// over wisp - with no external network.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { pages, textRoutes, PNG } from "./fixture.mjs";

const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(testsDir, "..");

wisp.options.allow_loopback_ips = true;
wisp.options.allow_private_ips = true;

export const ORIGIN_PORT = 4720;
export const HOST_PORT = 4721;
/**
 * A second, unrelated site. It is on a different loopback *address* rather
 * than a different port: cookies are keyed by host and ignore the port, so two
 * ports on 127.0.0.1 are the same site as far as the jar is concerned.
 */
export const ALT_ORIGIN_HOST = "127.0.0.2";
export const ALT_ORIGIN_PORT = 4722;
export const PREFIX = "/proxied/";

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

function formPage(query) {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>form</title></head>
<body>
<form id="search" method="get"><input name="q" value="new"><input type="hidden" name="page" value="2"></form>
<pre id="upstream">${query.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>
<pre id="seen"></pre>
<script>document.getElementById("seen").textContent = location.search;</script>
</body></html>`;
}

export function startOriginServer({ extraPages = {} } = {}) {
	const allPages = { ...pages, ...extraPages };
	const server = createServer((req, res) => {
		const [path, query = ""] = req.url.split("?");

		// Sets one httpOnly and one ordinary cookie for this origin, so the
		// suite can check which of them a page realm is handed.
		if (path === "/set-cookie") {
			res.writeHead(200, {
				"content-type": "text/plain",
				"cache-control": "no-store",
				"set-cookie": [
					"ownsession=OWN_SECRET_VALUE; Path=/; HttpOnly",
					"ownpublic=OWN_PUBLIC_VALUE; Path=/",
				],
			});

			return res.end("set");
		}

		// Echoes back exactly the query the origin received, so the suite can
		// assert what actually left the proxy rather than what the page thinks
		// it asked for.
		if (path === "/api/query") {
			const body = query;
			res.writeHead(200, {
				"content-type": "text/plain",
				"content-length": Buffer.byteLength(body),
				"cache-control": "no-store",
				"access-control-allow-origin": "*",
			});

			return res.end(body);
		}

		// A document that reports the query the origin actually received for it
		// alongside the query the proxied page believes it is on. A GET form
		// with no action submits to the document's own URL, which is the one
		// place a browser mutates a proxied URL's query directly.
		if (path === "/form.html") {
			const body = formPage(query);
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"content-length": Buffer.byteLength(body),
				"cache-control": "no-store",
			});

			return res.end(body);
		}

		if (allPages[path]) {
			const body = allPages[path];
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"content-length": Buffer.byteLength(body),
				"cache-control": "no-store",
			});

			return res.end(body);
		}

		if (textRoutes[path]) {
			const route = textRoutes[path];
			res.writeHead(200, {
				"content-type": route.type,
				"content-length": Buffer.byteLength(route.body),
				"cache-control": "no-store",
			});

			return res.end(route.body);
		}

		if (path.startsWith("/img/") && path.endsWith(".png")) {
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": PNG.length,
				"cache-control": "no-store",
			});

			return res.end(PNG);
		}

		res.writeHead(404, { "content-type": "text/plain" }).end("not found");
	});

	return new Promise((r) =>
		server.listen(ORIGIN_PORT, "127.0.0.1", () => r(server))
	);
}

/**
 * A second site. It exists so the suite can assert what one virtual origin is
 * allowed to learn about another - every virtual origin Sherpa serves shares
 * one physical origin, so "cross-origin" is entirely an engine property here
 * and needs a real second host to be tested at all.
 */
export function startAltOriginServer() {
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		const cors = {
			"access-control-allow-origin": "*",
			"cache-control": "no-store",
		};

		if (path === "/set-cookie") {
			res.writeHead(200, {
				...cors,
				"content-type": "text/plain",
				"set-cookie": [
					"altsession=ALT_SECRET_VALUE; Path=/; HttpOnly",
					"altpublic=ALT_PUBLIC_VALUE; Path=/",
				],
			});

			return res.end("set");
		}

		res.writeHead(404, { ...cors, "content-type": "text/plain" }).end("no");
	});

	return new Promise((r) =>
		server.listen(ALT_ORIGIN_PORT, ALT_ORIGIN_HOST, () => r(server))
	);
}

function harnessHtml() {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>sherpa behavior</title></head>
<body>
<script src="/baremux/index.js" defer></script>
<script src="/engine/sherpa.all.js" defer></script>
<script>
window.harnessReady = (async () => {
	await new Promise((r) => addEventListener("load", r));
	const { SherpaController } = $sherpaLoadController();
	const controller = new SherpaController({
		prefix: ${JSON.stringify(PREFIX)},
		files: {
			wasm: "/engine/sherpa.wasm.wasm",
			all: "/engine/sherpa.client.js",
			sync: "/engine/sherpa.sync.js",
		},
		flags: { rewriterLogs: false, scramitize: false, cleanErrors: true },
	});
	await controller.init();
	await navigator.serviceWorker.register("/sw.js");
	await navigator.serviceWorker.ready;
	const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
	await connection.setTransport("/epoxy/index.mjs", [{ wisp: "ws://" + location.host + "/wisp/" }]);
	window.__controller = controller;
	return true;
})();

let harnessFrame = null;
window.harnessNavigate = async (url) => {
	if (!harnessFrame) {
		harnessFrame = window.__controller.createFrame();
		harnessFrame.frame.style.width = "1000px";
		harnessFrame.frame.style.height = "800px";
		harnessFrame.frame.id = "proxied";
		document.body.appendChild(harnessFrame.frame);
		await new Promise((r) => setTimeout(r, 50));
	}
	const frame = harnessFrame;

	return new Promise((resolveNav, rejectNav) => {
		const onLoad = () => {
			let href = "";
			try { href = frame.frame.contentWindow.location.href; } catch {}
			if (href === "" || href === "about:blank") return;
			clearTimeout(timeout);
			frame.frame.removeEventListener("load", onLoad);
			resolveNav(href);
		};
		const timeout = setTimeout(() => {
			frame.frame.removeEventListener("load", onLoad);
			rejectNav(new Error("navigation timed out: " + url));
		}, 30000);
		frame.frame.addEventListener("load", onLoad);
		frame.go(url);
	});
};
</script>
</body></html>`;
}

const SW_JS = `importScripts("/engine/sherpa.all.js");
const { SherpaServiceWorker } = $sherpaLoadWorker();
const engine = new SherpaServiceWorker();
async function handleRequest(event) {
	await engine.loadConfig();
	if (engine.route(event)) return engine.fetch(event);
	return fetch(event.request);
}
self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});`;

export function startHostServer({
	port = HOST_PORT,
	distDir = join(repoRoot, "dist"),
} = {}) {
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		const send = (body, type) => {
			res.writeHead(200, {
				"content-type": type,
				"cross-origin-opener-policy": "same-origin",
				"cross-origin-embedder-policy": "require-corp",
				"cross-origin-resource-policy": "cross-origin",
				"cache-control": "no-store",
			});
			res.end(body);
		};

		if (path === "/" || path === "/harness.html")
			return send(harnessHtml(), "text/html");
		if (path === "/sw.js") return send(SW_JS, "text/javascript");
		// The browser asks for this on every navigation; a 404 would show up as
		// a console error the driver treats as a failure.
		if (path === "/favicon.ico") return send("", "image/x-icon");

		for (const [route, dir] of [
			["/engine/", distDir],
			["/baremux/", baremuxPath],
			["/epoxy/", epoxyPath],
		]) {
			if (path.startsWith(route)) {
				const file = join(dir, path.slice(route.length));
				const pathFromRoot = relative(dir, file);
				if (
					pathFromRoot === ".." ||
					pathFromRoot.startsWith(`..${sep}`) ||
					isAbsolute(pathFromRoot) ||
					!existsSync(file)
				)
					break;
				const ext = file.slice(file.lastIndexOf("."));

				return send(
					readFileSync(file),
					MIME[ext] ?? "application/octet-stream"
				);
			}
		}

		res
			.writeHead(404, {
				"cross-origin-opener-policy": "same-origin",
				"cross-origin-embedder-policy": "require-corp",
			})
			.end("not found");
	});

	server.on("upgrade", (req, socket, head) => {
		if (req.url.startsWith("/wisp/")) wisp.routeRequest(req, socket, head);
		else socket.end();
	});

	return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
