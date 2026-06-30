// entrypoint for sherpa.client.js

import { loadCodecs, setConfig } from "@/shared/index";
import { SHERPACLIENT } from "@/symbols";
import { SherpaClient } from "@client/index";
import { SherpaContextEvent, UrlChangeEvent } from "@client/events";
import { SherpaServiceWorkerRuntime } from "@client/swruntime";
import { SherpaConfig } from "@/types";

export const iswindow = "window" in globalThis && window instanceof Window;
export const isworker = "WorkerGlobalScope" in globalThis;
export const issw = "ServiceWorkerGlobalScope" in globalThis;
export const isdedicated = "DedicatedWorkerGlobalScope" in globalThis;
export const isshared = "SharedWorkerGlobalScope" in globalThis;
export const isemulatedsw =
	"location" in globalThis &&
	new URL(globalThis.location.href).searchParams.get("dest") ===
		"serviceworker";

function createFrameId() {
	return `${Array(8)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join("")}`;
}

export function loadAndHook(config: SherpaConfig) {
	setConfig(config);
	dbg.log("initializing sherpa client");
	// if it already exists, that means the handlers have probably already been setup by the parent document
	if (!(SHERPACLIENT in <Partial<typeof self>>globalThis)) {
		loadCodecs();

		const client = new SherpaClient(globalThis);
		const frame: HTMLIFrameElement =
			globalThis.frameElement as HTMLIFrameElement;
		if (frame && !frame.name) {
			// all frames need to be named for our logic to work
			frame.name = createFrameId();
		}

		if (globalThis.COOKIE) client.loadcookies(globalThis.COOKIE);

		client.hook();

		if (isemulatedsw) {
			const runtime = new SherpaServiceWorkerRuntime(client);
			runtime.hook();
		}

		const contextev = new SherpaContextEvent(client.global.window, client);
		client.frame?.dispatchEvent(contextev);
		const urlchangeev = new UrlChangeEvent(client.url.href);
		if (!client.isSubframe) client.frame?.dispatchEvent(urlchangeev);
	}

	Reflect.deleteProperty(globalThis, "WASM");
	Reflect.deleteProperty(globalThis, "COOKIE");
}
