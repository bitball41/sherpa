/**
 * @fileoverview
 * Type declarations so that Rslib doesn't complain about missing types.
 * Don't worry; these are handed perfectly fine by Rspack!
 */

declare global {
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
}

declare interface ImportMeta {
	webpackContext?: (request: string, options?: any) => any;
}

declare interface ErrorConstructor {
	stackTraceLimit?: number;
	prepareStackTrace?: (err: Error, stackTraces: NodeJS.CallSite[]) => any;
}
