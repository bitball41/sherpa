import { SherpaDB } from "@/types";
import { openDB, IDBPDatabase } from "idb";

// Opening an IndexedDB connection costs a browser-process round trip, and the
// security emulation used to do it several times for every proxied request.
// One connection per context is plenty; it only gets reopened if the browser
// terminates it abnormally.
let dbPromise: Promise<IDBPDatabase<SherpaDB>> | null = null;

/**
 * Gets a (cached) connection to the IndexedDB database
 *
 * @returns Promise that resolves to the database connection
 */
export function getDB(): Promise<IDBPDatabase<SherpaDB>> {
	if (!dbPromise) {
		dbPromise = openDB<SherpaDB>("$sherpa", 1, {
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
