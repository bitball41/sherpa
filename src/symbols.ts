/** Symbols shared across Sherpa realms. See `types.ts` for context. */

export const SHERPACLIENTNAME = "sherpa client global";
export const SHERPACLIENT = Symbol.for(SHERPACLIENTNAME);
export const SHERPAFRAME = Symbol.for("sherpa frame handle");
