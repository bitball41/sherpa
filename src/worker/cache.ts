/**
 * Storage glue for Sherpa's rewritten-response cache.
 *
 * The policy rules live in `@/shared/httpCache`; this file owns the
 * `CacheStorage` bucket, the key layout, and the read/write/evict paths the
 * service worker's fetch handler calls into.
 *
 * What is stored is the *rewritten* response, not the upstream bytes, so a hit
 * skips the transport **and** the oxc/htmlparser2 rewrite - which on repeat
 * visits is most of what a proxied page costs.
 */

// Imported relatively, and only from leaf modules, so this file can be loaded
// directly by `node --test` (see `tests/unit/responseCache.test.mjs`) instead
// of only through the bundler. `@/shared`'s barrel would drag in the WASM
// rewriter, which needs a Rust build to exist.
import { config } from "../shared/state";
import {
	fnv1a,
	responseCachePolicy,
	type HeaderRecord,
	type StorePolicy,
} from "../shared/httpCache";

export { cacheKeyUrl } from "../shared/httpCache";

/**
 * Cache-name namespace. Pages see a `CacheStorage` namespaced by their virtual
 * origin (`https://example.com@name`, see `@/shared/cacheNamespace`); an origin
 * can never contain `$`, so nothing a page opens or enumerates can collide with
 * or observe this bucket.
 */
const CACHE_NAME_PREFIX = "sherpa$response$v1$";

/** Freshness bookkeeping, written onto the stored copy only. */
const EXPIRES_HEADER = "sherpa-cache-expires";
const STORED_HEADER = "sherpa-cache-stored";

/**
 * Bodies above this never go in. The Cache API shares the origin's storage
 * quota with everything else Sherpa persists, and evicting a media file to
 * make room for another media file is not a cache, it is churn.
 */
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

/** Entry-count ceiling, and the level a sweep trims back to. */
const MAX_ENTRIES = 500;
const TRIM_TO_ENTRIES = 375;
/** Entries written between size sweeps. `Cache.keys()` is not free. */
const SWEEP_INTERVAL = 32;

let cachePromise: Promise<Cache | null> | null = null;
let cacheFingerprint: string | null = null;
let writesSinceSweep = 0;

/**
 * A fingerprint of everything that changes rewritten output. The cache name
 * embeds it, so a `modifyConfig` that swaps the prefix, codec, injected global
 * names or feature flags starts from a fresh bucket instead of serving output
 * rewritten under the old configuration.
 */
function configFingerprint(): string {
	return fnv1a(
		JSON.stringify([
			config.prefix,
			config.codec,
			config.globals,
			config.files,
			config.flags,
			config.siteFlags,
		])
	);
}

/** Drops buckets left behind by earlier configurations. */
async function dropStaleBuckets(keep: string): Promise<void> {
	const names = await caches.keys();
	await Promise.all(
		names
			.filter((name) => name.startsWith(CACHE_NAME_PREFIX) && name !== keep)
			.map((name) => caches.delete(name))
	);
}

function openCache(): Promise<Cache | null> {
	// CacheStorage is absent in non-secure contexts and can throw outright when
	// storage is partitioned away. A proxy that works without a cache is
	// strictly better than one that fails to fetch because of it.
	if (typeof caches === "undefined") return Promise.resolve(null);

	const fingerprint = configFingerprint();
	if (cachePromise && cacheFingerprint === fingerprint) return cachePromise;

	cacheFingerprint = fingerprint;
	const name = CACHE_NAME_PREFIX + fingerprint;
	cachePromise = caches
		.open(name)
		.then((cache) => {
			dropStaleBuckets(name).catch(() => {
				// Best effort: a leftover bucket costs quota, not correctness.
			});

			return cache;
		})
		.catch((error) => {
			console.warn("Sherpa response cache unavailable", error);

			return null;
		});

	return cachePromise;
}

export type CachedEntry = {
	/** The stored rewritten response, ready to serve. */
	response: Response;
	/** False when the entry needs revalidating before it can be used. */
	fresh: boolean;
	etag: string | null;
	lastModified: string | null;
};

function stripCacheMetadata(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.delete(EXPIRES_HEADER);
	headers.delete(STORED_HEADER);
	// The variance this entry was keyed on is already baked into the key, and a
	// `Vary` left on the copy the page receives only invites confusion.
	headers.delete("vary");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Looks a variant up. Returns `null` when there is nothing usable; a stale
 * entry comes back with `fresh: false` and its validators, so the caller can
 * turn the upstream request into a conditional one.
 */
export async function lookupCachedResponse(
	keyUrl: string,
	now: number
): Promise<CachedEntry | null> {
	try {
		const cache = await openCache();
		if (!cache) return null;

		const stored = await cache.match(keyUrl);
		if (!stored) return null;

		const expiresAt = Number(stored.headers.get(EXPIRES_HEADER));
		const fresh = Number.isFinite(expiresAt) && expiresAt > now;
		const etag = stored.headers.get("etag");
		const lastModified = stored.headers.get("last-modified");

		if (!fresh && !etag && !lastModified) {
			// Expired with nothing to revalidate against: it can never be used
			// again, so reclaim the space now rather than at the next sweep.
			cache.delete(keyUrl).catch(() => {});

			return null;
		}

		return { response: stripCacheMetadata(stored), fresh, etag, lastModified };
	} catch (error) {
		console.warn("Sherpa response cache lookup failed", error);

		return null;
	}
}

/** Releases a cloned body this side is never going to read. */
async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Already errored or locked; nothing left to release.
	}
}

/**
 * Reads a response body, giving up as soon as it exceeds `limit`.
 *
 * `await response.arrayBuffer()` then checking the size only rejects an
 * oversized body *after* holding all of it in memory - and the caller's
 * `clone()` tees the page's own stream, so whatever this branch reads ahead is
 * buffered by the browser too. A body with no `content-length` (any chunked
 * response) therefore had no bound at all, and one that never ends would have
 * been accumulated for as long as it ran. Cancelling the moment the limit is
 * passed both frees the tee and tears the read side down.
 */
async function readBounded(
	response: Response,
	limit: number
): Promise<Uint8Array<ArrayBuffer> | null> {
	if (!response.body) return new Uint8Array(await response.arrayBuffer());

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let overLimit = false;

	try {
		for (;;) {
			// eslint-disable-next-line no-await-in-loop
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;

			total += value.byteLength;
			if (total > limit) {
				overLimit = true;
				break;
			}
			chunks.push(value);
		}
	} catch {
		// A torn-down transport mid-body is not a cache entry.
		return null;
	}

	if (overLimit) {
		try {
			await reader.cancel();
		} catch {
			// Already gone; the point was only to stop the tee from growing.
		}

		return null;
	}

	// Stream chunks in a service worker are always ArrayBuffer-backed.
	if (chunks.length === 1) return chunks[0] as Uint8Array<ArrayBuffer>;

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return body;
}

/**
 * Stores a rewritten response under an already-approved {@link StorePolicy}.
 *
 * Takes a *clone* - the caller keeps the original for the page - and is only
 * ever called once the policy said yes, so a rejected response never leaves an
 * unread tee behind. Failures are swallowed: a full quota or a torn-down
 * worker must not turn into a failed page load.
 */
export async function storeCachedResponse(
	keyUrl: string,
	policy: StorePolicy,
	response: Response,
	now: number
): Promise<void> {
	try {
		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_ENTRY_BYTES)
			return await discardBody(response);

		const cache = await openCache();
		// Every path that gives up has to release this branch of the tee. An
		// abandoned one keeps the browser buffering the page's own copy of the
		// body for as long as the response lives.
		if (!cache) return await discardBody(response);

		const body = await readBounded(response, MAX_ENTRY_BYTES);
		if (!body) return;

		const headers = new Headers(response.headers);
		headers.set(EXPIRES_HEADER, String(policy.expiresAt));
		headers.set(STORED_HEADER, String(now));

		await cache.put(
			keyUrl,
			new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			})
		);

		if (++writesSinceSweep >= SWEEP_INTERVAL) {
			writesSinceSweep = 0;
			await trimCache(cache);
		}
	} catch (error) {
		console.warn("Sherpa response cache write failed", error);
	}
}

/**
 * Serves a revalidated entry after a `304`, refreshing its freshness window.
 * Upstream may restate headers alongside the `304`; those win over the stored
 * copy's.
 */
export async function refreshCachedResponse(
	keyUrl: string,
	entry: CachedEntry,
	responseHeaders: HeaderRecord,
	now: number,
	destination: string = ""
): Promise<Response> {
	const merged = new Headers(entry.response.headers);
	for (const name of Object.keys(responseHeaders)) {
		const value = responseHeaders[name];
		if (value === undefined) continue;
		// A 304's `content-length`/`content-encoding` describe its own (absent)
		// body, never the stored one, and a wrong length truncates the response.
		const lower = name.toLowerCase();
		if (lower === "content-length" || lower === "content-encoding") continue;
		merged.set(lower, Array.isArray(value) ? value.join(", ") : value);
	}

	const body = await entry.response.arrayBuffer();
	const served = new Response(body, {
		status: 200,
		statusText: "OK",
		headers: merged,
	});

	// The 304 restates the entry's freshness, so re-derive the window from the
	// merged headers and write it back - otherwise every later request for this
	// resource revalidates again.
	const flattened: HeaderRecord = Object.create(null);
	merged.forEach((value, name) => {
		flattened[name] = value;
	});
	const policy = responseCachePolicy(200, flattened, now, destination);
	if (policy) {
		storeCachedResponse(keyUrl, policy, served.clone(), now).catch(() => {});
	}

	return served;
}

/**
 * Keeps the bucket bounded. `Cache.keys()` returns entries in insertion order,
 * so trimming from the front is a FIFO eviction - approximate, but it costs one
 * enumeration rather than a stored access time per entry.
 */
async function trimCache(cache: Cache): Promise<void> {
	const keys = await cache.keys();
	if (keys.length <= MAX_ENTRIES) return;

	const excess = keys.slice(0, keys.length - TRIM_TO_ENTRIES);
	await Promise.all(excess.map((request) => cache.delete(request)));
}

/** Drops every stored response. Exposed for cache-busting and for tests. */
export async function clearResponseCache(): Promise<void> {
	cachePromise = null;
	cacheFingerprint = null;
	writesSinceSweep = 0;
	if (typeof caches === "undefined") return;

	const names = await caches.keys();
	await Promise.all(
		names
			.filter((name) => name.startsWith(CACHE_NAME_PREFIX))
			.map((name) => caches.delete(name))
	);
}
