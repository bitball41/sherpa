import { SherpaClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";
import type { RawSourceMap } from "@/shared/sourcemaps";

export class SingletonBox {
	/**
	 * Which client owns a given realm's `location`, for the cross-realm
	 * `location = ...` assignment path in `shared/wrap.ts`.
	 *
	 * Weak, and the only registry that survives: a `SingletonBox` is shared by
	 * every frame in a Sherpa context and outlives all of them, so the strong
	 * `Map`s that used to sit here (plus a `clients` array, and per-realm
	 * `globals`/`documents` maps that nothing ever read) pinned the `Window`,
	 * `Document` and `Location` of every iframe that had ever existed for the
	 * lifetime of the top frame. A single-page app that mounts and discards
	 * frames leaked all of them.
	 *
	 * `WeakMap.get` on a non-object returns `undefined` rather than throwing,
	 * which matters: the lookup runs against whatever value the page had in a
	 * variable named `location`.
	 */
	locations: WeakMap<Location, SherpaClient> = new WeakMap();

	/** Decoded rewrite tables, materialized on first use per scramtag. */
	sourcemaps: SourceMaps = {};
	/**
	 * Maps as their scripts pushed them, still undecoded.
	 *
	 * Every rewritten script pushes one as its first statement, but the only
	 * consumer is `Function.prototype.toString`, which almost no page calls on
	 * rewritten code. Decoding eagerly allocated one object per rewrite - tens
	 * of thousands for a large minified bundle - on the critical path of every
	 * script, and then retained them for the life of the realm.
	 */
	rawSourcemaps: Record<string, RawSourceMap> = Object.create(null);

	constructor(public ownerclient: SherpaClient) {}

	registerClient(client: SherpaClient, global: Self) {
		if (global.location) this.locations.set(global.location, client);
	}
}
