import type { CookieStore } from "@/shared/cookie";
import { getDB } from "@/shared/security/db";

/**
 * Coalesced persistence for the service worker's cookie jar.
 *
 * The jar is authoritative in memory; IndexedDB only exists so a session
 * survives the browser restarting the service worker. Persisting it used to sit
 * on the response path - every response carrying a `Set-Cookie` serialized the
 * whole jar, re-parsed it into an object, and *awaited* an IndexedDB
 * transaction before the response reached the page. On a site that sets cookies
 * on most responses that is a jar-sized serialize plus a storage round trip per
 * subresource, all of it serialized on the single service-worker event loop.
 *
 * Instead: at most one write is ever in flight, another is queued if the jar
 * changed while it ran, and callers get a promise that only settles once a
 * write reflecting *their* change has completed. Fire-and-forget on the
 * response path, awaitable where durability is worth waiting for.
 */

let running = false;
let dirty = false;
let settled: Promise<void> = Promise.resolve();

async function writeJar(store: CookieStore): Promise<void> {
	try {
		const db = await getDB();
		// The jar is stored as its JSON text: `CookieStore.load` already accepts
		// both shapes, and handing IndexedDB the string skips a full re-parse of
		// the jar on every write.
		await db.put("cookies", store.dump(), "cookies");
	} catch (error) {
		// Storage can be unavailable or over quota. An in-memory jar that does
		// not survive a worker restart beats a failed page load.
		console.warn("failed to persist Sherpa cookies", error);
	}
}

export function persistCookieStore(store: CookieStore): Promise<void> {
	dirty = true;
	if (running) return settled;

	running = true;
	settled = (async () => {
		while (dirty) {
			dirty = false;
			// Serialized on purpose: overlapping writes of the same key would
			// race, and coalescing them is the whole point.
			// eslint-disable-next-line no-await-in-loop
			await writeJar(store);
		}
		running = false;
	})();

	return settled;
}
