import { SherpaClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";
export declare class SingletonBox {
    ownerclient: SherpaClient;
    clients: SherpaClient[];
    globals: Map<Self, SherpaClient>;
    documents: Map<Document, SherpaClient>;
    locations: Map<Location, SherpaClient>;
    sourcemaps: SourceMaps;
    constructor(ownerclient: SherpaClient);
    registerClient(client: SherpaClient, global: Self): void;
}
