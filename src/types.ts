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

/**
 * Theming and branding for Sherpa's built-in error page — the page shown when
 * a proxied navigation fails. Every field is plain, serializable data, so it
 * can be set through the {@link SherpaController} config and is persisted and
 * hot-swapped like the rest of the Sherpa config (no need to edit the engine
 * source). Set any subset of fields; anything you leave out falls back to the
 * Sherpa defaults in `DEFAULT_ERROR_PAGE`.
 *
 * @example
 * ```typescript
 * new SherpaController({
 *   errorPage: {
 *     accent: "#a1c5f3",
 *     title: "This page didn't load",
 *     logo: "/brand/logo.svg",
 *   },
 * });
 * ```
 */
export interface SherpaErrorPageConfig {
	/** Page background color. Default: `#ffffff` (white). */
	background: string;
	/** Card / textarea / secondary surface color. Default: `#eef0fb`. */
	surface: string;
	/** Primary text color. Default: `#222444` (deep navy). */
	text: string;
	/** Muted / secondary text color. Default: `#a0a1dc` (lavender). */
	muted: string;
	/** Accent color for primary buttons and links. Default: `#a1c5f3` (sky). */
	accent: string;
	/** Text color drawn on top of {@link accent}. Default: `#222444`. */
	accentText: string;
	/** Sans-serif font stack for body copy. */
	fontSans: string;
	/** Monospace font stack for the error trace. */
	fontMono: string;
	/** Heading shown at the top of the page. Default: `"Uh oh!"`. */
	title: string;
	/** Optional logo (URL or data URI) shown above the title. Empty = none. */
	logo: string;
	/** Repository URL for the "GitHub repository" troubleshooting link. */
	repoUrl: string;
	/** Extra CSS appended verbatim to the page, for full control. */
	css: string;
}

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
	errorPage: SherpaErrorPageConfig;
	codec: {
		encode: string;
		decode: string;
	};
}

/**
 * The config for Sherpa initialization.
 */
export interface SherpaInitConfig extends Omit<
	SherpaConfig,
	"codec" | "flags" | "errorPage"
> {
	flags: Partial<SherpaFlags>;
	errorPage: Partial<SherpaErrorPageConfig>;
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
