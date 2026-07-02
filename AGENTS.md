# Sherpa — context for AI coding agents

Sherpa is a fork of Mercury Workshop's [Scramjet](https://github.com/MercuryWorkshop/scramjet)
(the `legacy`/1.x branch — NOT `main`/2.x, which the owner considers worse and
explicitly rejected as a base), rebranded and being incrementally rewritten.
It's the proxy engine for a separate web-proxy app called **Bardo**, which
lives at `C:\Users\cjnis\liminal` on this machine. Bardo currently runs stock
Scramjet v1/v2 as unmodified npm dependencies; the point of Sherpa is to give
the owner an engine they actually own and can keep modifying, instead of an
upstream black box.

This file is the durable, tool-agnostic source of truth for this project.
(There is also Claude-Code-specific memory/plan state elsewhere on this
machine, but treat _this file plus `git log`_ as authoritative — re-derive
anything that seems stale from those.)

## Decisions already made (do not re-litigate without asking the owner)

- **Name:** Sherpa. **Base:** upstream's `legacy` branch (1.x), not `main`.
- **Location:** the working checkout is `C:\Users\cjnis\sherpa`; the public
  repository is `github.com/bitball41/sherpa` (matching the GitHub org that
  owns Bardo, NOT the owner's personal `cjnis` account).
- **License:** Scramjet is AGPL-3.0-only; this fork keeps that license
  verbatim. When/if this gets wired into Bardo and published, the plan is to
  keep the Sherpa repo public and add a "Source code" link in Bardo's
  Settings → Advanced pane to satisfy AGPL §13 — this does NOT require
  open-sourcing the rest of Bardo, just this component.
- **Rewrite goals (owner-selected):** (1) better site compatibility, (2)
  performance/size. Explicitly NOT a goal: stealth/anti-detection.
- **Engine slot in Bardo:** Sherpa is meant to become a 5th selectable engine
  alongside Bardo's existing `scramjet` / `scramjet2` / `klystron` / `opulent`
  — additive, not a replacement, not the default, labeled "experimental".

## Current state (check `git log --oneline` to confirm this is still accurate)

20 commits past the upstream `legacy` baseline. Key changes include:

- `3316c04a`/`f3d73e09`/`458677d0` — rebrand pass (scramjet→sherpa renamed
  throughout: globals like `$scramjetLoadController`→`$sherpaLoadController`,
  classes like `ScramjetController`→`SherpaController`, the `"$scramjet"`
  IndexedDB name→`"$sherpa"`, dist filenames, package.json metadata, README
  fork-attribution notice). 650 occurrences across 87 files, verified zero
  stragglers via `git grep -i scramjet`.
- `b1961234` — removed the `parse-domain` dependency (zero imports anywhere
  in `src/`, pure dead weight).
- `09facf8f` — fixed a real bug: `EventSource.prototype.url` getter was
  missing a `return`, always returned `undefined`.
- `904a5db7` + `78593f89` — implemented real Service Worker scope tracking
  end-to-end. Previously: the registered scope was stored as the _script
  URL_ instead of the real scope, never transmitted to the worker context at
  all, and fetch-interception matched workers by origin only (no scope
  check) — meaning any one registered worker for an origin would intercept
  _every_ request to that origin regardless of path. Now threads the real
  scope (explicit `options.scope`, else default directory-of-script-URL)
  through registration → `postMessage` → `FakeServiceWorker`, and through the
  `SharedWorker`'s own URL as a query param so the worker-side runtime can
  report `registration.scope` correctly. Fetch matching now filters by
  scope-prefix and picks the most specific (longest) match. Also fixed an
  unrelated bug found in the same file: `src/client/dom/serviceworker.ts`
  referenced a `registration` variable that was never declared anywhere,
  meaning `getRegistration()` / `.ready` / `.controller` threw
  `ReferenceError` whenever called.
- Same commit (`78593f89`) also re-implemented charset-aware HTML decoding
  in `src/worker/fetch.ts`. It previously always decoded response bodies as
  UTF-8 via `response.text()` (the original charset-sniffing code was
  disabled — its regex broke on single-quoted/unquoted `<meta charset>`
  attributes). New `detectHtmlCharset()`/`decodeWithCharset()` helpers
  implement the HTML spec's sniffing order (HTTP header → BOM → `<meta
charset>` sniffed from the first 1024 bytes decoded as windows-1252,
  default utf-8), and the outgoing `Content-Type` charset is normalized to
  `utf-8` since the rewritten body always goes back out UTF-8-encoded
  regardless of the source charset.
- `5c46974a` — investigated `src/client/dom/origin.ts`'s `"this isn't
right!!"` TODO on the `origin` trap. Conclusion: `client.url.origin` is
  actually correct for the normal case. The real gap is opaque origin for
  `<iframe sandbox>` without `allow-same-origin` (real browsers force
  `window.origin` to the literal string `"null"` there) — but there's no
  sandbox-attribute tracking anywhere in the client/frame model to support a
  correct fix, and it's unresolved in upstream's `main`/2.x branch too. Owner
  said skip it; documented in `KNOWN_ISSUES.md`.

Four more compat fixes landed after the block above (each addresses an item
that used to be in "What's NOT done yet"):

- `85e90af0` — `Element.prototype.setAttributeNode` was an empty no-op stub;
  now it runs the real attribute through Sherpa's rewriting trap (URL/CSS/
  srcdoc), records the original for the page-facing attribute APIs, and
  restores the replaced node's value so detaching doesn't lose it. Also
  respects native `InUseAttributeError` semantics.
- `411020ba` — cross-realm `location` assignment in `src/client/shared/wrap.ts`
  now goes through the `box.locations` map / `trysetfn` path so
  `otherframe.location = "..."` works across realms instead of only same-realm.
- `d0705915` — the synchronous-XHR watchdog in
  `src/client/shared/requests/xmlhttprequest.ts` was a hardcoded 1s timeout;
  it's been extended/reworked so slow sync requests aren't cut off prematurely.
- `ed255a97` — CORS/credentials emulation in `src/worker/fetch.ts` (+
  `request.ts`, `headers.ts`): virtual requests now honor the real
  `credentials` mode and referrer policy instead of always forcing
  `credentials: "omit"`. This resolves the self-admitted "i was against cors
  emulation but we might break stuff" TODO.
- The worker fetch path retries a bodyless `GET`/`HEAD`/`OPTIONS` once when
  Epoxy/Hyper reports a remote HTTP/2 `GOAWAY(NO_ERROR)`, preventing a graceful
  connection rotation from becoming a user-visible Sherpa error page.

### Latest polish pass

- `src/shared/rewriters/url.ts` — `rewriteUrl`/`unrewriteUrl` now pass
  **non-http(s) URL schemes through untouched** (`tel:`, `sms:`, `intent:`,
  `magnet:`, `ftp:`, `ws:`, …) instead of mangling them into proxied URLs.
  Previously a `<a href="tel:...">` or an Android `intent://` deep link got
  URL-encoded behind the proxy prefix and broke; now only `http:`/`https:`
  (and relative/protocol-relative URLs that resolve to them) are proxied,
  mirroring what `SherpaController.encodeUrl` already did. Verified against a
  spread of schemes. `unrewriteUrl` also short-circuits anything that isn't
  actually prefixed with the proxy origin so it can't slice a missing prefix
  into garbage.
- `assets/sherpa.png` — replaced the leftover **Scramjet** logo art (the
  rebrand had renamed the file but never swapped the image) with the real
  Sherpa logo. Removed the stray `sherpa logo.png` from the repo root.
- `README.md` — rewritten into a proper front page (logo, how-it-works,
  library usage, build-from-source, project layout, AGPL note).
- `src/entry.ts` — fixed a rebrand straggler: a JSDoc referenced
  `MercuryWorkshop/sherpa` (wrong repo) → `bitball41/sherpa`.
- `KNOWN_ISSUES.md` — expanded to track the remaining deferred compat gaps
  (below) with reasoning, not just the sandboxed-origin one.

**Build verified after every change above:** `pnpm build` + `pnpm build:types`
both clean (rspack + rslib typecheck), and a manual browser smoke test
(load `sherpa.all.js`, `$sherpaLoadController()` → instantiate
`SherpaController` → `await ctrl.init()` → `ctrl.encodeUrl(...)`, plus
`$sherpaLoadWorker()` class load) passes. `dist/` total size dropped from
~2.32MB to ~1.61MB (~30% smaller): `sherpa.wasm.wasm` 867KB→534KB (this was
the RELEASE=1 fix), `sherpa.bundle.js` 1.34MB→897KB (parse-domain removal).

### Customization pass

Turned the error page into a first-class, config-driven customization feature
and leaned into "customization" as Sherpa's differentiator vs Scramjet.

- **Error-page theming.** New `SherpaErrorPageConfig` type (`src/types.ts`) on
  `SherpaConfig`/`SherpaInitConfig`, with the single source of truth for
  defaults in `src/shared/errorPage.ts` (`DEFAULT_ERROR_PAGE`, re-exported from
  `@/shared`). `src/controller/controller.ts` seeds it into `defaultConfig`;
  `src/worker/error.ts` merges `{ ...DEFAULT_ERROR_PAGE, ...config.errorPage }`
  at render time and injects the theme (CSS variables + title/logo/repo link via
  the existing JSON.stringify'd data-URI script). All plain serializable data,
  so it persists to IDB and hot-swaps like the rest of the config — no engine
  edits needed. `errorPage.css` is appended last so devs can override anything.
- **New default palette:** a clean _light_ theme — white bg, `#222444` (deep
  navy) text, `#a0a1dc` (lavender) muted, `#a1c5f3` (sky blue) accent — replacing
  the old dark beach/orange theme.
- **Preview mechanism.** Navigating to `` `${prefix}$error` `` renders the themed
  page with a sample trace (early sentinel check in `src/worker/fetch.ts`, before
  any real fetch). `SherpaController.errorPreviewUrl` getter returns that URL;
  the `static/` demo wires it to an "error page" toolbar button.
- **Fixed a latent config gap** that this feature depends on: the worker's
  `loadConfig` _message_ handler (`src/worker/index.ts`) set `this.config` but
  never called `setConfig`, so runtime `modifyConfig` updates never reached the
  module-level shared `config` that the error template / `flagEnabled` /
  rewriters read (nor re-parsed the codecs). Now calls `setConfig(data.config)`,
  so runtime re-theming (and flags/siteFlags/codec updates) actually take effect.
- **Rebrand straggler fixed:** the error page's troubleshooting link pointed at
  `github.com/MercuryWorkshop/sherpa` (wrong repo) — now the configurable
  `repoUrl`, defaulting to `github.com/bitball41/sherpa`. Same stale link fixed
  in `static/ui.js` (the commit link).
- **README:** added a "What makes Sherpa different from Scramjet" section
  (under the what-is paragraphs) and a "Customization" section documenting the
  error page + the other existing knobs (`prefix`, `codec`, `flags`, `siteFlags`,
  `globals`, `files`).

Build verified (`pnpm build` + `pnpm build:types` both clean) and browser-tested
end-to-end via the preview route: defaults render correctly (white/navy/sky), and
a fully custom theme (custom colors + title + logo, applied at runtime through
`modifyConfig`) renders correctly too, with no console errors.

### HTML rewriter compat pass (`src/shared/rewriters/html.ts`)

Three defects fixed in the HTML rewriter; all three also exist unfixed in
upstream's `main`/2.x (verified against the fetched tree), so none can be
ported — these are original fixes.

- **`rewriteSrcset` was badly broken.** The old `srcset.split(/ .*,/)` used a
  greedy regex that (a) dropped middle candidates entirely (`"a 1x, b 2x, c
3x"` → only a and c survive), (b) stripped the first candidate's descriptor,
  and (c) failed to split descriptor-less srcsets (`"a.png, b.png"` came out
  as one mangled URL with a trailing comma). Rewritten as a parser following
  the HTML spec's srcset algorithm: URL runs to whitespace, a trailing comma
  on the URL token ends the candidate, otherwise the descriptor runs to the
  next top-level (paren-aware) comma. Handles data: URIs with embedded
  commas. This affects `img`/`source` `srcset` and `link` `imagesrcset` via
  `htmlRules`, in both the worker's static-HTML path and the client's DOM
  attribute traps.
- **`<meta http-equiv=refresh>` rewriting was case-sensitive and crashy.**
  `http-equiv === "refresh"` and `split("url=")` missed the canonical
  uppercase forms (`Refresh`, `URL=`), so those refreshes navigated to the
  real, unproxied URL — punching through the proxy. A `refresh` meta with no
  `content` attribute threw, killing the whole HTML rewrite for the page. Now
  matched ASCII case-insensitively, quoted URL values are handled, and a
  missing `content` is a no-op.
- **Inline script type detection missed spec-JS types.** The old
  `/(application|text)\/javascript|module|undefined/` test skipped
  `type=""` (which the spec treats as classic JS) and case variants like
  `text/JavaScript`, so those inline scripts ran **unrewritten** — real
  `location`/`top`/etc., a proxy escape. It also over-matched garbage like
  `type="nomodule"` via substring. New `scriptTypeEssence()`/
  `isJsScriptType()` helpers: ASCII case-insensitive, parameters stripped
  (`text/javascript;charset=utf-8` executes), full JS MIME essence list
  (`x-`/`ecma` variants, `javascript1.0-1.5`, `jscript`, `livescript`), and
  the `module`/`?type=module` checks now share the same essence parsing.

Verified three ways: 45 unit assertions on the parsing logic (scratch
harness), `pnpm build`/`build:types`/`test:package` clean with no new lint
errors, and end-to-end in a browser through the real SW pipeline (playground
`playgroundData` injection under a fake origin): all srcset candidates come
out proxied with descriptors preserved, `type=""`/`TEXT/JavaScript` scripts
execute rewritten (they see the emulated origin, not the real one),
`application/ld+json` is left untouched, and an uppercase `URL=` refresh
target gets proxied.

### Performance pass (benchmarked vs upstream Scramjet 1.x)

Goal: make Sherpa measurably faster than the Scramjet it forked, with
evidence. A reproducible benchmark harness now lives in `bench/` (see
`bench/README.md` for methodology + full results). It compares against two
baselines that are the same frozen code: the fork-point commit `57ba89e`
(bundled from source for controlled micro benchmarks) and the published
`@mercuryworkshop/scramjet@1.1.0` dist (for end-to-end browser runs and wire
size).

- **Optimizations** (all output-equivalent, verified byte-for-byte across
  10k+ comparisons by `bench/verify.mjs`): chunked `bytesToBase64` (was one
  string object per byte — dominates inline-script-heavy pages); CSS regexes
  compiled once + matches rebuilt from capture groups (was a quadratic
  rescan per match that also corrupted `$&`-style URLs); char-code srcset
  scanning (was a regex per character); indexed child traversal (was
  `for..in` over an array); element work gated on `attribs`; script MIME
  essence computed once; first-char gate before the URL scheme
  `startsWith` chain; cached `location.origin + prefix`; fragment handling
  via `href` slicing (skips the `hash` setter); `flagEnabled` regex cache;
  **`initWasm` latch** (the WASM rewriter was synchronously recompiled via
  `new WebAssembly.Module` on every JS rewrite because `initSync`'s argument
  was evaluated before its internal guard); worker-side WASM bootstrap
  payload cached per worker lifetime (was re-base64ing ~0.5 MB per page
  load); charset decoders hoisted.
- **Results:** rewriters 1.3–1.8× faster (5.3× on script-heavy HTML), also
  confirmed on live-captured Wikipedia/MDN pages (1.38–1.44×); end-to-end
  proxied page loads in Chromium 1.12–1.26× faster across two independent
  runs; cold start at parity; wire size at parity (~1% larger than
  published Scramjet while carrying more compat fixes).
- **Environment note:** `rewriter/wasm/out/` is gitignored and needed for
  `pnpm build`; on a machine without the Rust toolchain the wasm-bindgen
  glue can be recovered from the committed dist source maps
  (`dist/sherpa.bundle.js.map` → `sourcesContent` for
  `rewriter/wasm/out/wasm.js` and its snippet), plus a hand-written
  `wasm.d.ts`. CI builds the real thing (cached by Cargo hash).

## What's NOT done yet

**Remaining compat gaps.** The four safely-fixable items from the original
research pass are now done (see "Current state"). What's left is genuinely
harder or architectural — each is documented with reasoning in
`KNOWN_ISSUES.md`, and the honest engineering call is that forcing a "fix"
risks breaking more sites than it helps, so they're deferred, not queued:

- `javascript:` URL **unrewriting** is still a `//TODO`
  (`src/shared/rewriters/url.ts`). The forward direction (rewrite) works; the
  reverse can't cleanly recover the original because `rewriteJs` isn't a
  losslessly reversible transform. Upstream leaves it too. (Note: the
  unrelated URL-_scheme_ mangling in the same file was fixed this pass — see
  "Latest polish pass".)
- `postMessage` origin detection is fragile and falls back to guessing / an
  empty pollutant when all three args are strings
  (`src/client/shared/postmessage.ts`) — a fundamental cross-realm
  limitation, risky to change.
- CSS property proxy is an admitted "dumb hack" that traps every property
  individually (`src/client/dom/css.ts`) — it works; rewriting it is risky.
- `cleanrestfn` (`$sherpa$clean`) is emitted by the Rust rewriter for rest/
  spread patterns but implemented as an **empty no-op** in
  `src/client/shared/wrap.ts`. Matches upstream; reimplementing it wrong would
  corrupt legitimate rest objects on every site, so left alone.
- A few places silently swallow errors in bare `catch {}` blocks
  (`src/client/shared/error.ts`, `document.ts`, `element.ts`, `client.ts`).
  Most are intentional rewrite-failure fallbacks (bad HTML/CSS → raw value),
  not real bugs.

To find fresh gaps if this list goes stale, re-run a survey across
`src/client/**` / `src/worker/**` / `src/shared/**` for
`TODO`/`FIXME`/`hack`/`jank`/admitted-hack comments.

**Phase D — wiring Sherpa into Bardo as the 5th engine — is implemented in
`C:\Users\cjnis\liminal`.** The integration touches:

- `package.json` — add `"sherpa": "file:../sherpa"` as a local dependency
  (not published, so not a git/npm-registry dependency yet)
- `src/lib/types.ts` — add `"sherpa"` to the `EngineName` union (currently
  `"scramjet" | "scramjet2" | "klystron" | "opulent"`)
- `src/lib/constants.ts` — add `SVC_PREFIX_SHERPA = "/sherpa/service/"`
  alongside the existing per-engine prefix constants
- `src/lib/core.ts` — add a `"sherpa"` branch to `activeSvcPrefix()` and
  `initEngine()`, a new `initSherpa()`/`startSherpaController()` pair modeled
  on the existing `initScramjet()`/`startScramjetController()` (Sherpa uses
  the full controller path like stock Scramjet v1, NOT the lightweight
  `PrefixFrame` model used by klystron/opulent/scramjet2), and an _additive_
  append to `forceReload()`'s service-worker-unregister and IndexedDB-cleanup
  loops (do not touch the existing entries for the other 4 engines —
  `forceReload()` is shared across all engines and this is the highest-risk
  edit in that file)
- `src/components/settings/Settings.tsx` — append a `["sherpa", "Sherpa",
"<hint>"]` tuple to the engine-picker array (the sole source of truth for
  that UI, no separate registry exists)
- `public/sw-sherpa.js` — new file, adapt from the existing `public/sw.js`
- `server.ts` — static mount for Sherpa's dist + a `/sw-sherpa.js` route,
  mirroring the existing `/scramjet/` block
- `vite.config.ts` — add `/sherpa` and `/sw-sherpa.js` to the dev-server
  passthrough list
- After wiring in: verify Sherpa works end-to-end in a real browser, then
  **regression-test the other 4 engines still work** since several shared
  files get touched.

A full step-by-step plan for this (with more file:line detail) exists at
`C:\Users\cjnis\.claude\plans\i-want-to-make-sequential-shamir.md` if that
path is reachable from wherever this is being read.

## Toolchain (if building from scratch on a new machine/environment)

Already installed and verified on this machine — if working somewhere else,
these all need installing first:

- `rustup` + the `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` pinned to **exactly** version `0.2.100` (the build
  script hard-checks this — `cargo install wasm-bindgen-cli --version
0.2.100`)
- Binaryen's `wasm-opt` (`npm install -g binaryen` ships a prebuilt binary)
- The `wasm-snip` fork from `github.com/r58Playz/wasm-snip` — **not** the
  crates.io version (`cargo install --git
https://github.com/r58Playz/wasm-snip`)
- `pnpm`
- On Windows specifically: the above `cargo install` steps need Microsoft's
  MSVC linker, i.e. Visual Studio Build Tools with the C++ workload
  (`winget install --id Microsoft.VisualStudio.2022.BuildTools --override
"--add Microsoft.VisualStudio.Workload.VCTools"`) — a multi-GB download,
  hit this as a blocker once already.

Build sequence: `pnpm i` → `RELEASE=1 pnpm rewriter:build` (compiles the Rust
WASM codec — **always use RELEASE=1**, the default skips wasm-opt entirely
and produces a much bigger, debug-symbol-laden binary) → `pnpm build` →
`pnpm build:types`.

Note: upstream's `.gitignore` excludes `dist/` and `rewriter/wasm/out` etc.
— if this ever needs to be consumed as a git dependency (rather than a local
`file:` dependency), the built `dist/` will need to be force-added
(`git add -f dist`) since git dependencies don't run build scripts unless
explicitly configured to.

## AGPL note

Scramjet/Sherpa is AGPL-3.0-only. If this gets embedded in a network-served
app (Bardo) and modified, AGPL §13 requires offering the complete modified
source to users interacting with it over the network. The plan is: keep this
repo public once published, add a visible source-code link in Bardo's UI.
Don't make it closed-source without revisiting that.
