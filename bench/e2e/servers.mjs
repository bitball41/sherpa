// Three local servers for the end-to-end benchmark:
//   - a fixture ORIGIN server (the "website" being proxied)
//   - two identical proxy HOSTS, one running Sherpa's dist, one running the
//     published @mercuryworkshop/scramjet@1.1.0 dist, each with its own wisp
//     endpoint and the same bare-mux + epoxy transport builds
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { pages, jsFiles, cssFiles, PNG } from "./fixtures.mjs";

const benchDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(benchDir, "..");

wisp.options.allow_loopback_ips = true;
wisp.options.allow_private_ips = true;

export const ORIGIN_PORT = 4620;
export const HOST_PORTS = { sherpa: 4621, scramjet: 4622 };

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

export function startOriginServer() {
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		let body;
		let type = "text/html";

		if (pages[path]) body = pages[path];
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
		res.writeHead(200, {
			"content-type": type,
			"content-length": Buffer.byteLength(body),
			"cache-control": "no-store",
		});
		res.end(body);
	});

	return new Promise((r) =>
		server.listen(ORIGIN_PORT, "127.0.0.1", () => r(server))
	);
}

const ENGINES = {
	sherpa: {
		distDir: join(repoRoot, "dist"),
		filePrefix: "sherpa",
		loadController: "$sherpaLoadController",
		loadWorker: "$sherpaLoadWorker",
		controllerClass: "SherpaController",
		workerClass: "SherpaServiceWorker",
		prefix: "/proxied/",
	},
	scramjet: {
		distDir: join(benchDir, "node_modules/@mercuryworkshop/scramjet/dist"),
		filePrefix: "scramjet",
		loadController: "$scramjetLoadController",
		loadWorker: "$scramjetLoadWorker",
		controllerClass: "ScramjetController",
		workerClass: "ScramjetServiceWorker",
		prefix: "/proxied/",
	},
};

function harnessHtml(e) {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e.filePrefix} bench</title></head>
<body>
<script src="/baremux/index.js" defer></script>
<script src="/engine/${e.filePrefix}.all.js" defer></script>
<script>
window.benchReady = (async () => {
	await new Promise((r) => addEventListener("load", r));
	const { ${e.controllerClass} } = ${e.loadController}();
	const controller = new ${e.controllerClass}({
		prefix: ${JSON.stringify(e.prefix)},
		files: {
			wasm: "/engine/${e.filePrefix}.wasm.wasm",
			all: "/engine/${e.filePrefix}.all.js",
			sync: "/engine/${e.filePrefix}.sync.js",
		},
		flags: { rewriterLogs: false, scramitize: false, cleanErrors: true, sourcemaps: true },
	});
	await controller.init();
	await navigator.serviceWorker.register("/sw.js");
	await navigator.serviceWorker.ready;
	const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
	await connection.setTransport("/epoxy/index.mjs", [{ wisp: "ws://" + location.host + "/wisp/" }]);
	window.__controller = controller;
	return true;
})();

// one persistent frame per harness, navigated repeatedly - mirrors how a
// real proxy tab is actually used
let benchFrame = null;
window.benchNavigate = async (url) => {
	if (!benchFrame) {
		benchFrame = window.__controller.createFrame();
		benchFrame.frame.style.width = "1000px";
		benchFrame.frame.style.height = "800px";
		document.body.appendChild(benchFrame.frame);
		// let the iframe's initial about:blank load settle before timing
		await new Promise((r) => setTimeout(r, 50));
	}
	const frame = benchFrame;

	return new Promise((resolveNav, rejectNav) => {
		const onLoad = () => {
			// ignore any straggling blank load; only the proxied document counts
			let href = "";
			try {
				href = frame.frame.contentWindow.location.href;
			} catch {}
			if (href === "" || href === "about:blank") return;
			const ms = performance.now() - t0;
			clearTimeout(timeout);
			frame.frame.removeEventListener("load", onLoad);
			resolveNav(ms);
		};
		const timeout = setTimeout(() => {
			frame.frame.removeEventListener("load", onLoad);
			frame.frame.remove();
			benchFrame = null;
			rejectNav(new Error("navigation timed out: " + url));
		}, 25000);
		frame.frame.addEventListener("load", onLoad);
		const t0 = performance.now();
		frame.go(url);
	});
};
</script>
</body></html>`;
}

function swJs(e) {
	return `importScripts("/engine/${e.filePrefix}.all.js");
const { ${e.workerClass} } = ${e.loadWorker}();
const engine = new ${e.workerClass}();
async function handleRequest(event) {
	await engine.loadConfig();
	if (engine.route(event)) return engine.fetch(event);
	return fetch(event.request);
}
self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});`;
}

export function startHostServer(engineName) {
	const e = ENGINES[engineName];
	const server = createServer((req, res) => {
		const path = req.url.split("?")[0];
		const send = (body, type, extra = {}) => {
			res.writeHead(200, {
				"content-type": type,
				"cross-origin-opener-policy": "same-origin",
				"cross-origin-embedder-policy": "require-corp",
				"cross-origin-resource-policy": "cross-origin",
				"cache-control": "no-store",
				...extra,
			});
			res.end(body);
		};

		if (path === "/" || path === "/bench.html")
			return send(harnessHtml(e), "text/html");
		if (path === "/sw.js") return send(swJs(e), "text/javascript");

		for (const [route, dir] of [
			["/engine/", e.distDir],
			["/baremux/", baremuxPath],
			["/epoxy/", epoxyPath],
		]) {
			if (path.startsWith(route)) {
				const file = join(dir, path.slice(route.length));
				if (!file.startsWith(dir) || !existsSync(file)) break;
				const ext = file.slice(file.lastIndexOf("."));

				return send(
					readFileSync(file),
					MIME[ext] ?? "application/octet-stream"
				);
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
		server.listen(HOST_PORTS[engineName], "127.0.0.1", () => r(server))
	);
}
