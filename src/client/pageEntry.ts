/**
 * Page-injected runtime. Proxied documents load this file, not the host
 * all-bundle, so host factory names never appear in rewritten pages.
 * Only `loadAndHook` is exposed so other class names can be mangled.
 */
import { PAGE_LOAD_CLIENT } from "@/shared/pageSurface";
import { loadAndHook } from "./entry";

const loadClient = () => ({ loadAndHook });
(globalThis as Record<string, unknown>)[PAGE_LOAD_CLIENT] = loadClient;

if ("document" in globalThis && document?.currentScript) {
	document.currentScript.remove();
}
