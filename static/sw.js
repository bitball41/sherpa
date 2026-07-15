/// <reference path="../lib/index.d.ts" />

// dumb hack to allow firefox to work (please dont do this in prod)
if (navigator.userAgent.includes("Firefox")) {
	Object.defineProperty(globalThis, "crossOriginIsolated", {
		value: true,
		writable: false,
	});
}

importScripts("/scram/sherpa.all.js");
const { SherpaServiceWorker } = $sherpaLoadWorker();
const sherpa = new SherpaServiceWorker();

async function handleRequest(event) {
	await sherpa.loadConfig();
	if (sherpa.route(event)) {
		return sherpa.fetch(event);
	}

	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});

let playgroundData;
self.addEventListener("message", (event) => {
	const { data, source } = event;
	if (!data || typeof data !== "object" || data.type !== "playgroundData")
		return;
	if (
		typeof source?.url !== "string" ||
		typeof data.html !== "string" ||
		typeof data.css !== "string" ||
		typeof data.js !== "string" ||
		typeof data.origin !== "string"
	)
		return;

	try {
		const sourceUrl = new URL(source.url);
		const playgroundUrl = new URL("playground.html", self.registration.scope);
		const virtualOrigin = new URL(data.origin);
		if (
			sourceUrl.origin !== playgroundUrl.origin ||
			sourceUrl.pathname !== playgroundUrl.pathname ||
			(virtualOrigin.protocol !== "http:" &&
				virtualOrigin.protocol !== "https:")
		)
			return;

		playgroundData = {
			html: data.html,
			css: data.css,
			js: data.js,
			origin: virtualOrigin.origin,
		};
	} catch {
		// Ignore malformed or non-client playground messages.
	}
});

sherpa.addEventListener("request", (e) => {
	if (playgroundData && e.url.origin === playgroundData.origin) {
		const headers = {};
		const origin = playgroundData.origin;
		if (e.url.href === origin + "/") {
			headers["content-type"] = "text/html";
			e.response = new Response(playgroundData.html, {
				headers,
			});
		} else if (e.url.href === origin + "/style.css") {
			headers["content-type"] = "text/css";
			e.response = new Response(playgroundData.css, {
				headers,
			});
		} else if (e.url.href === origin + "/script.js") {
			headers["content-type"] = "application/javascript";
			e.response = new Response(playgroundData.js, {
				headers,
			});
		} else {
			e.response = new Response("empty response", {
				headers,
			});
		}
		e.response.rawHeaders = headers;
		e.response.rawResponse = {
			body: e.response.body,
			headers: headers,
			status: e.response.status,
			statusText: e.response.statusText,
		};
		e.response.finalURL = e.url.toString();
	} else {
		return;
	}
});
