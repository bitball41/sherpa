// Minimal Sherpa service worker.
//
// It loads the worker half of the engine and hands every in-scope request to
// Sherpa; everything else falls through to the network. This whole file is the
// service-worker "install" — there is nothing else to it.

// Firefox doesn't expose crossOriginIsolated inside workers even with COOP/COEP
// set. Sherpa only reads the flag, so asserting it here is a safe dev shim.
if (navigator.userAgent.includes("Firefox")) {
	Object.defineProperty(globalThis, "crossOriginIsolated", { value: true });
}

importScripts("/scram/sherpa.all.js");

const { SherpaServiceWorker } = $sherpaLoadWorker();
const sherpa = new SherpaServiceWorker();

self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			await sherpa.loadConfig();
			if (sherpa.route(event)) return sherpa.fetch(event);

			return fetch(event.request);
		})()
	);
});
