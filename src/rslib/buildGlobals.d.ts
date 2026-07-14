/// <reference types="@rspack/core/module" />

/**
 * @fileoverview Internal declarations used while building Sherpa. These are
 * intentionally not copied into the published declaration tree.
 */

export {};

declare global {
	const dbg: {
		log: (message: string, ...args: any[]) => void;
		warn: (message: string, ...args: any[]) => void;
		error: (message: string, ...args: any[]) => void;
		debug: (message: string, ...args: any[]) => void;
		time: (meta: unknown, before: number, type: string) => void;
	};

	const COMMITHASH: string;
	const VERSION: string;

	interface GlobalThis {
		$sherpaLoadController: any;
		$sherpaLoadClient: any;
		$sherpaLoadWorker: any;
		$sherpaRequire: any;
		$sherpaVersion: {
			build: string;
			version: string;
		};
	}

	interface ImportMeta {
		webpackContext?: (request: string, options?: any) => any;
	}

	interface ErrorConstructor {
		stackTraceLimit?: number;
		prepareStackTrace?: (err: Error, stackTraces: NodeJS.CallSite[]) => any;
	}
}
