import { SherpaDB } from "@/types";
import { openDB, IDBPDatabase } from "idb";

// Opening an IndexedDB connection costs a browser-process round trip, and the
// security emulation used to do it several times for every proxied request.
// One connection per context is plenty; it only gets reopened if the browser
// terminates it abnormally.
let dbPromise: Promise<IDBPDatabase<SherpaDB>> | null = null;

// Version 1 could be created by the service worker without an upgrade callback,
// leaving a permanently empty database. Version 2 repairs those installations
// and keeps every context on the same schema initializer.
const DB_VERSION = 2;

function createStores(db: IDBPDatabase<SherpaDB>): void {
	if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
	if (!db.objectStoreNames.contains("cookies")) db.createObjectStore("cookies");
	if (!db.objectStoreNames.contains("redirectTrackers"))
		db.createObjectStore("redirectTrackers");
	if (!db.objectStoreNames.contains("referrerPolicies"))
		db.createObjectStore("referrerPolicies");
	if (!db.objectStoreNames.contains("publicSuffixList"))
		db.createObjectStore("publicSuffixList");
}

/**
 * Gets a (cached) connection to the IndexedDB database
 *
 * @returns Promise that resolves to the database connection
 */
export function getDB(): Promise<IDBPDatabase<SherpaDB>> {
	if (!dbPromise) {
		dbPromise = openDB<SherpaDB>("$sherpa", DB_VERSION, {
			upgrade(db) {
				createStores(db);
			},
			terminated() {
				dbPromise = null;
			},
		});
		dbPromise.catch(() => {
			dbPromise = null;
		});
	}

	return dbPromise;
}
