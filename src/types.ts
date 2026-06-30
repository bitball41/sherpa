import { SherpaClient } from "@client/index";
import { SherpaFrame } from "@/controller/frame";
import { SHERPACLIENT, SHERPAFRAME } from "@/symbols";
import * as controller from "@/controller/index";
import * as client from "@/client/entry";
import * as worker from "@/worker/index";
import { DBSchema } from "idb";

/**
 * Version information for the current Sherpa build.
 * Contains both the semantic version string and the git commit hash for build identification.
 */
export interface SherpaVersionInfo {
	/** The git commit hash that this build was created from */
	build: string;
	/** The semantic version */
	version: string;
}

/**
 * Sherpa Feature Flags, configured at build time
 */
export type SherpaFlags = {
	serviceworkers: boolean;
	syncxhr: boolean;
	strictRewrites: boolean;
	rewriterLogs: boolean;
	captureErrors: boolean;
	cleanErrors: boolean;
	scramitize: boolean;
	sourcemaps: boolean;
	destructureRewrites: boolean;
	interceptDownloads: boolean;
	allowInvalidJs: boolean;
	allowFailedIntercepts: boolean;
};

export interface SherpaConfig {
	prefix: string;
	globals: {
		wrapfn: string;
		wrappropertybase: string;
		wrappropertyfn: string;
		cleanrestfn: string;
		importfn: string;
		rewritefn: string;
		metafn: string;
		setrealmfn: string;
		pushsourcemapfn: string;
		trysetfn: string;
		templocid: string;
		tempunusedid: string;
	};
	files: {
		wasm: string;
		all: string;
		sync: string;
	};
	flags: SherpaFlags;
	siteFlags: Record<string, Partial<SherpaFlags>>;
	codec: {
		encode: string;
		decode: string;
	};
}

/**
 * The config for Sherpa initialization.
 */
export interface SherpaInitConfig
	extends Omit<SherpaConfig, "codec" | "flags"> {
	flags: Partial<SherpaFlags>;
	codec: {
		encode: (url: string) => string;
		decode: (url: string) => string;
	};
}
declare global {
	var $sherpaLoadController: () => typeof controller;
	var $sherpaLoadClient: () => typeof client;
	var $sherpaLoadWorker: () => typeof worker;
	var $sherpaVersion: SherpaVersionInfo;
	interface Window {
		COOKIE: string;
		WASM: string;
		REAL_WASM: Uint8Array;

		/**
		 * The sherpa client belonging to a window.
		 */
		[SHERPACLIENT]: SherpaClient;
	}

	interface HTMLDocument {
		/**
		 * Should be the same as window.
		 */
		[SHERPACLIENT]: SherpaClient;
	}

	interface HTMLIFrameElement {
		/**
		 * The event target belonging to an iframe element holding an encoded URL.
		 */
		[SHERPAFRAME]: SherpaFrame;
	}
}

export type SiteDirective = "same-origin" | "same-site" | "cross-site" | "none";

export interface RedirectTracker {
	originalReferrer: string;
	mostRestrictiveSite: SiteDirective;
	referrerPolicy: string;
	chainStarted: number;
}

export interface ReferrerPolicyData {
	policy: string;
	referrer: string;
}

export interface SherpaDB extends DBSchema {
	config: {
		key: string;
		value: SherpaConfig;
	};
	cookies: {
		key: string;
		value: any;
	};
	redirectTrackers: {
		key: string;
		value: RedirectTracker;
	};
	referrerPolicies: {
		key: string;
		value: ReferrerPolicyData;
	};
	publicSuffixList: {
		key: string;
		value: { data: string[]; expiry: number };
	};
}
