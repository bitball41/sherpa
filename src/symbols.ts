/** Symbols shared across Sherpa realms. See `types.ts` for context. */

import { CLIENT_SYMBOL_KEY, FRAME_SYMBOL_KEY } from "./shared/pageSurface";

export const SHERPACLIENTNAME = CLIENT_SYMBOL_KEY;
export const SHERPACLIENT = Symbol.for(SHERPACLIENTNAME);
export const SHERPAFRAME = Symbol.for(FRAME_SYMBOL_KEY);
