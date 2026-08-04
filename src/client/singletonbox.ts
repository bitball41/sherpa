import { SherpaClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";
import type { RawSourceMap } from "@/shared/sourcemaps";

export class SingletonBox {
	clients: SherpaClient[] = [];
	globals: Map<Self, SherpaClient> = new Map();
	documents: Map<Document, SherpaClient> = new Map();
	locations: Map<Location, SherpaClient> = new Map();

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
		this.clients.push(client);
		this.globals.set(global, client);
		this.documents.set(global.document, client);
		this.locations.set(global.location, client);
	}
}
