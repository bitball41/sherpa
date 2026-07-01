import { SherpaErrorPageConfig } from "../types";
/**
 * Sherpa's default error-page theme.
 *
 * A clean, light theme built from Sherpa's palette — white, deep navy
 * (`#222444`), lavender (`#a0a1dc`), and sky blue (`#a1c5f3`). Every value here
 * is overridable per-deployment via the `errorPage` field of the
 * {@link SherpaController} config, so a developer can rebrand the error page
 * without touching the engine source.
 *
 * This constant is the single source of truth for the defaults: the controller
 * seeds its config from it, and the worker merges any missing fields against it
 * at render time (so older persisted configs without an `errorPage` still get a
 * fully themed page).
 */
export declare const DEFAULT_ERROR_PAGE: SherpaErrorPageConfig;
