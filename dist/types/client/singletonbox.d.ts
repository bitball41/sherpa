import { SherpaClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";
import type { RawSourceMap } from "../shared/sourcemaps";
export declare class SingletonBox {
    ownerclient: SherpaClient;
    clients: SherpaClient[];
    globals: Map<Self, SherpaClient>;
    documents: Map<Document, SherpaClient>;
    locations: Map<Location, SherpaClient>;
    /** Decoded rewrite tables, materialized on first use per scramtag. */
    sourcemaps: SourceMaps;
    /**
     * Maps as their scripts pushed them, still undecoded.
     *
     * Every rewritten script pushes one as its first statement, but the only
     * consumer is `Function.prototype.toString`, which almost no page calls on
     * rewritten code. Decoding eagerly allocated one object per rewrite - tens
     * of thousands for a large minified bundle - on the critical path of every
     * script, and then retained them for the life of the realm.
     */
    rawSourcemaps: Record<string, RawSourceMap>;
    constructor(ownerclient: SherpaClient);
    registerClient(client: SherpaClient, global: Self): void;
}
