import { SherpaClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";

export class SingletonBox {
	clients: SherpaClient[] = [];
	globals: Map<Self, SherpaClient> = new Map();
	documents: Map<Document, SherpaClient> = new Map();
	locations: Map<Location, SherpaClient> = new Map();

	sourcemaps: SourceMaps = {};

	constructor(public ownerclient: SherpaClient) {}

	registerClient(client: SherpaClient, global: Self) {
		this.clients.push(client);
		this.globals.set(global, client);
		this.documents.set(global.document, client);
		this.locations.set(global.location, client);
	}
}
