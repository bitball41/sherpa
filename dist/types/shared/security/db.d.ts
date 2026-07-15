import { SherpaDB } from "../../types";
import { IDBPDatabase } from "idb";
/**
 * Gets a (cached) connection to the IndexedDB database
 *
 * @returns Promise that resolves to the database connection
 */
export declare function getDB(): Promise<IDBPDatabase<SherpaDB>>;
