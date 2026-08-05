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

### Per-request hot-path pass (service-worker security emulation)

The first perf pass optimized the rewriters; this one removed the per-request
overhead in the worker's security emulation (`src/shared/security/`), which
runs for **every** proxied request and was inherited unchanged from upstream:

- **One IndexedDB connection per context** (`src/shared/security/db.ts`).
  Every helper used to call `openDB()` per operation — 4–6 fresh connections
  per proxied request across `forceReferrer.ts`, `siteTests.ts`, and
  `src/worker/index.ts`. Now a cached connection promise (reopened only on
  abnormal termination).
- **Redirect trackers moved in-memory** (`forceReferrer.ts`). They previously
  cost four awaited IDB transactions per request (get+put on init, get on
  read, delete on completion) for state that only lives for a single
  request/redirect chain, all handled by the same worker instance. Same
  1-hour TTL, swept lazily; worst case on a worker restart mid-chain is one
  `Sec-Fetch-Site` computed from the final hop only — the same fallback as an
  expired tracker.
- **Referrer policies get a write-through cache with negative entries**
  (`forceReferrer.ts`). Still persisted in IDB (pages outlive SW restarts),
  but reads are served from a bounded Map — including "known absent", which
  is the common case and used to cost an IDB read per response.
- **Public-suffix-list matching indexed** (`siteTests.ts`). The old code
  linearly scanned all ~10.2k PSL rules, calling `split(".")` on every rule,
  for every registrable-domain computation — measured at **~2.4 ms per
  lookup**, i.e. ~5 ms per cross-origin request on the request path plus the
  same again in `rewriteHeaders`. Now the list is parsed once into
  exact/wildcard/exception sets and matched bottom-up per the PSL spec
  algorithm in O(labels) (~0.003 ms), with a bounded per-hostname memo.
  Verified against the old algorithm on the real 10,228-rule list: 13k+
  equivalence checks, 0 mismatches.
- **PSL loading fixed three ways** (`siteTests.ts`): the parsed index lives
  in memory (the IDB copy is only read once per worker lifetime); concurrent
  cold-cache callers share one in-flight load (previously a page's worth of
  parallel cross-origin requests each started its own ~230 KB download); and
  a failed download now degrades to the stale index or a naive eTLD+1
  fallback (with a 60 s retry window) instead of **throwing and turning the
  proxied request into an error page** whenever publicsuffix.org was
  unreachable through the transport.
- **Real bug fixed in `src/worker/fetch.ts`:** the Set-Cookie loop was
  `for (const cookie in maybeHeaders)` — iterating array _indices_ — so the
  client's synchronous cookie store was told the cookie was the string
  `"0"`. `document.cookie` reads missed HTTP-set cookies until the next full
  page load re-seeded the jar. Now iterates the values.

All verified with a scratch harness that bundles the real modules via
esbuild with `idb` stubbed in-memory and a mock transport: equivalence vs the
old PSL algorithm, fetch-dedup under 50-way parallel cold start, offline
fallback, tracker/policy behavior. `pnpm build`, `build:types`,
`test:package` clean; lint has only pre-existing errors (6, down from 8 on
main — the rewrite removed two).

### CSS `url()` scanner + first committed unit-test suite

- **CSS `url()` rewriting is now a quote-aware scanner** (new
  `src/shared/rewriters/cssUrls.ts`, wired into `src/shared/rewriters/css.ts`),
  retiring the old `url\((['"]?)(.+?)(['"]?)\)` regex. This closes the
  `KNOWN_ISSUES.md` item that invited exactly this change ("replace the regex
  with a quote-aware tokenizer ... ship as its own compat change with
  fixtures"). The old lazy regex stopped at the first `)` even inside a quoted
  URL, so `url('/logo(1).svg?x=(y)')` was truncated at `/logo(1` and the
  `.svg?x=(y)` tail leaked into the surrounding declaration; with the default
  `encodeURIComponent` codec it only self-heals when nothing codec-sensitive
  (`?`, `=`, `&`, `/`, `#`) follows the paren, and corrupts outright under a
  custom codec. The scanner walks the sheet once (single linear pass, no
  backtracking), and is strictly more correct in three additional ways the
  regex got wrong: it **skips `url(...)` written inside CSS strings**
  (`content:"url(x)"`) **and comments**, it matches the case-insensitive
  `URL(`/`Url(` spellings the grammar allows (preserving author casing on
  output), and it leaves empty `url()`/`url("")` untouched instead of
  rewriting them to the base URL. `@import "bare.css"` string handling is
  unchanged (still the separate `Atruleregex` pass, which skips `url()` forms).
- **Verified** against the fork-point baseline via `bench/verify.mjs`: 10,133
  equivalent, exactly 3 divergent — all three are the buggy baseline being
  corrected (`url( "..." )` with spaces, and the string/comment false
  positives). This is the documented, expected divergence for this compat
  change, so `bench/`'s equivalence gate is not the right guard for it.
- **First committed unit tests.** `cssUrls.ts` is deliberately dependency-free
  so it loads straight from TypeScript under Node's native type stripping;
  `tests/unit/cssUrls.test.mjs` (16 `node --test` fixtures) pins the tokenizer
  behavior. New `pnpm test:unit` script (added to `pnpm test` and the CI
  `package-validation` job). This is the repo's first source-level unit suite —
  earlier passes used throwaway scratch harnesses; the CSS logic is isolated
  enough to keep its fixtures in-tree.

### Cookie jar RFC 6265 correctness pass (`src/shared/cookie.ts`)

`CookieStore` is the single jar behind both the service worker's outgoing
`Cookie` header and the client's `document.cookie` getter, so its
matching/expiry logic runs on effectively every request and every JS cookie
read. Three inherited divergences from RFC 6265, each of which real sites hit,
are fixed:

- **Path-match over-matched (§5.1.4).** The read path used a bare
  `!url.pathname.startsWith(cookie.path)`, so a cookie scoped to `/foo` was
  also served on `/foobar` (and `/foo` matched `/foobarbaz`). Now a prefix
  only matches when the cookie path ends in `/` or the next request-path
  character is `/`, so `/foo` matches `/foo` and `/foo/bar` but not `/foobar`.
- **Domain-match over-matched (§5.1.3).** The read path used
  `url.hostname.endsWith(cookie.domain.slice(1))`, so a cookie for
  `.example.com` was served to the look-alike host `notexample.com`. Now the
  host must equal the domain or be a true dotted subdomain of it.
- **`Max-Age` was ignored for expiry (§4.1.2.2 / §5.3).** `set-cookie-parser`
  surfaces `maxAge`, but `getCookies` only ever consulted `expires`, so the
  canonical delete-a-cookie response (`Set-Cookie: name=; Max-Age=0`) was
  stored and then served _forever_, and `Max-Age` session lifetimes never
  expired. `setCookies` now folds `Max-Age` into an absolute `expires` at
  store time (Max-Age taking precedence over Expires, per spec), so the
  existing expiry sweep in `getCookies` honors it with no read-path change.
  Also hardened `setCookies` to drop empty/malformed `Set-Cookie` headers
  instead of storing a `name=undefined` junk entry.

Review hardening (from PR #5 bot review, both points verified real): expiry
dates are stored as ISO 8601; a non-numeric `Max-Age` (`parseInt` → NaN) or
unparseable `Expires` is ignored per §5.2.2/§5.2.1 (session cookie) instead of
storing a never-expiring `"Invalid Date"`; and the domain-match runs whether or
not the stored domain has its leading dot, so a dotless entry from `load()`ed
data can't bypass the check and match every host.

Covered by `tests/unit/cookie.test.mjs` (8 `node --test` fixtures; 4 of them
fail against the pre-fix code). `CookieStore` only pulls in
`set-cookie-parser`, so like `cssUrls.ts` it loads straight from TypeScript
under Node's native type stripping — no build step. Source-only change: the
committed `dist/` bundles are regenerated by CI (`pnpm pack` → `prepack`), and
`dist/sherpa.wasm.wasm` is untouched since no Rust changed.

### Lint cleanup — `pnpm lint` is now clean (was 6 errors + 36 warnings)

`eslint ./src/` now reports **zero** problems (previously 6 errors and 36
warnings, all inherited from upstream). No behavior changed — verified
output-equivalent through `bench/verify.mjs` (still the CSS-only divergences)
plus `build`/`build:types`/`test:*`. What was done:

- **Errors (6).** Two `newline-before-return`; one `no-constant-condition`
  (`if (1) return;` in `dbg.time` → a named `TIMING_ENABLED = false` module
  toggle, same disabled-by-default behavior but self-documenting and
  re-enablable); one unnecessary empty template literal (` ` ``→`""`); two
  `quotes`on font stacks that legitimately contain`"..."`— fixed at the
  config by adding`{ avoidEscape: true }`to the`quotes` rule (the idiomatic
  setting: single quotes are the correct choice when the string embeds double
  quotes), so the source stays as written.
- **Warnings (36 → 0).** `prefer-const` via `eslint --fix`; unused imports
  removed; unused trap/handler args prefixed with `_`; two genuinely dead
  assignments deleted (`realLocalStorage`, and a `before` timestamp whose only
  consumer was a commented-out `dbg.time`). The single `no-await-in-loop` in
  `src/worker/fetch.ts` is intentional (Set-Cookie headers must seed the
  client's synchronous jar in order) — now carries a reasoned
  `eslint-disable-next-line` instead of standing as a bare warning.

### `Refresh` header + reflected-getter compat pass

Five fixes, all closing paths where a proxied page saw the real (un-rewritten)
origin. Verified `build` (rspack) + `build:types` (rslib typecheck) + `lint`
clean and the full `test:unit` suite green (60 assertions, 6 new).

- **HTTP `Refresh` response header is now rewritten** (`src/shared/rewriters/`).
  Browsers honor `Refresh: <seconds>; url=<url>` exactly like
  `<meta http-equiv=refresh>`, but only the meta form was being rewritten — a
  server-sent `Refresh` header navigated the document straight to the real,
  un-proxied target (absolute URL → full proxy escape; relative URL → resolved
  against the proxied doc URL and 404/escaped). The `<seconds>[; url=<url>]`
  parsing is now a shared, dependency-free `rewriteRefresh()` in the new
  `refresh.ts`, consumed by both `html.ts` (meta) and `headers.ts` (header). The
  extraction is byte-for-byte equivalent to the old inline meta logic (checked
  across 14 inputs incl. quoted/case-variant/relative/trailing-junk), and
  `tests/unit/refresh.test.mjs` pins it.
- **`Document.parseHTMLUnsafe` was trapped on the wrong object**
  (`src/client/dom/document.ts`). It's a _static_ method on `Document`, not on
  `Document.prototype`; the prototype trap silently no-op'd (the proxy helper
  bails when `Reflect.has` is false), so HTML injected via
  `Document.parseHTMLUnsafe(...)` ran completely unrewritten. Now traps the
  static. (Swept for sibling misplaced-static traps — this was the only one;
  `CSSStyleValue.parse` and `DOMParser.prototype.parseFromString` were already
  correct.)
- **Reflected URL getters realigned with `htmlRules`**
  (`src/client/dom/element.ts`). `htmlRules` rewrites `src` on `<input
type=image>` and `<track>` and `href` on `<area>`, but the page-facing
  property getters that unrewrite those back omitted `HTMLInputElement`,
  `HTMLTrackElement`, and `HTMLAreaElement` — so reading `el.src` / `area.href`
  handed the page the proxied URL. Added them, and guarded the getter-install
  loop against an absent constructor / getter-less descriptor (skip instead of
  throwing from the getter later and breaking the whole `hook()`).
- **`<style>.innerHTML` getter now unrewrites CSS.** The setter rewrites CSS
  through `innerHTML`, but the getter returned the rewritten text verbatim
  (proxied `url()`s leaking to the page) — asymmetric with both its own setter
  and the neighboring `textContent` trap. Now `unrewriteCss`, matching them.

### Correctness sweep — cookie persistence, reflected getters, small fixes

A full read-through of `src/` (every file) turned up a handful of concrete
defects, each fixed. Verified `build` (rspack) + `build:types` (rslib
typecheck) + `lint` clean and `test:unit` green (62 assertions, 2 new). The
env has no Rust toolchain, so the `rewriter/wasm/out/` glue was reconstructed
from `dist/sherpa.bundle.js.map`'s `sourcesContent` (per the note under "What's
NOT done yet" / Environment) plus a hand-written `wasm.d.ts`; the committed
`.wasm` is unchanged (no Rust touched).

- **Cookie persistence across service-worker restarts was silently broken**
  (`src/shared/cookie.ts`). `CookieStore.load()` did `if (typeof cookies ===
"object") return cookies;` — returning the object **without ever assigning
  `this.cookies`**. The client injects the jar as a JSON _string_ (works), but
  the service worker restores it from IndexedDB where it comes back as a
  structured-cloned _object_, so the worker's persisted jar was dropped on
  every SW restart (a session-cookie login didn't survive until the site
  re-set it). Now assigns for both shapes. Covered by two new
  `tests/unit/cookie.test.mjs` fixtures (the object/SW path and the
  string/client round-trip); the existing suite only ever exercised the string
  path, which is why this slipped through.
- **`video.poster` handed the page a proxied URL**
  (`src/client/dom/element.ts`). `htmlRules` rewrites `poster` on `<video>`,
  and the reflected-getter install loop covers it, but the getter only
  unrewrote `src`/`data`/`href`/`action`/`formaction` — so reading
  `video.poster` returned the proxied absolute URL. Added `poster` to the
  unrewrite set (same class of fix as the `input`/`track`/`area` pass above).
- **`cleanErrors` stack scrubbing deleted the wrong line**
  (`src/client/shared/error.ts`). It did `const line = lines.find(...);
lines.splice(line, 1)` — `find` returns the matched _string_, and
  `splice("<string>", 1)` coerces the index to `NaN → 0`, so it removed the
  first stack line (usually the error message) and left the Sherpa frame in
  place. Now uses `findIndex` with an `idx !== -1` guard. (Behind the
  `cleanErrors` flag, off by default.)
- **`navigator.serviceWorker.getRegistrations()` returned `[undefined]`**
  (`src/client/dom/serviceworker.ts`) when nothing was registered, so a site
  iterating the result threw on `undefined.scope`. Now resolves `[]` in that
  case (spec returns an array of registrations).
- **`Content-Disposition: inline; filename="…"` was force-downloaded**
  (`src/worker/fetch.ts`). `isDownload` compared the whole header to the string
  `"inline"`, so only a bare `inline` showed in-browser; the common
  `inline; filename="doc.pdf"` form (a server asking for in-browser display)
  fell through to the download path. Now parses the leading disposition _type_
  token, so `inline`/`inline; …` display and `attachment`/anything-else
  download, matching the grammar.
- **Removed a rebrand-straggler console warning** (`src/controller/index.ts`)
  that told every Sherpa user "you are using the last version of sherpa v1 …
  please upgrade to v2" — Sherpa deliberately forks the 1.x line and there is
  no Sherpa v2, so the message was actively misleading on every controller
  load.

### Bottleneck attribution pass (measurement only, no engine changes)

`bench/bottleneck/` answers "what bottlenecks Sherpa?" now that the
engine-vs-engine wins are banked. Two harnesses: `rewrite-cost.mjs` (real
rewriters via `dist/sherpa.bundle.js` — the published micro bench stubbed
the WASM JS rewriter and disabled `sourcemaps`) and `e2e-phases.mjs`
(direct-vs-proxied browser loads, instrumented SW per-request timing,
client-boot micro, CDP trace, shaped 60ms-RTT/10Mbit link, repeat-visit
against a cacheable origin). Full report with numbers in
`bench/bottleneck/README.md`. Ranked findings:

1. **Nothing is ever cached** — SW-synthesized responses bypass the HTTP
   cache, no Cache API use anywhere, rewritten output never memoized:
   repeat visits are ~10× slower than direct (230ms vs 24ms on a small
   page over a shaped link). Highest-leverage fix: a rewritten-response
   Cache API layer in the worker.
2. **Full-response buffering** (`rewriteBody` → `arrayBuffer()`) — doc
   TTFB equals the whole download: 1207ms vs 51ms direct on a 1.2MiB page
   at 10Mbit (2.3s vs 1.2s total). Fix = streaming/early-flush HTML
   rewrite (hard; upstream 2.x went streaming for this reason).
3. **Per-document client boot ~45–60ms serial** — ~32ms of it is the
   per-byte `Uint8Array.from(atob(WASM), cb)` decode in the injected boot
   (`src/shared/rewriters/wasm.ts`), plus parsing a 695KiB base64 payload
   `<script>` per document.
4. **Wire inflation** — rewritten HTML 2–2.5×; default `sourcemaps: true`
   adds +43% to every minified script (map serialized as a decimal array
   literal in the SW path of `rewriteJs`) and ~25% rewrite CPU.
5. **Per-request SW overhead 1.5–10ms** engine CPU per subresource,
   serialized on the single SW event loop.

### Two-pass repository audit and hardening

Every repository file was read twice (all 217 UTF-8 files; the large binary
fixture was identity-checked separately). The resulting working branch is a
broad correctness/security/release hardening pass rather than one isolated
bug fix. Important groups:

- **Configuration and policy correctness.** Partial runtime updates now
  deep-merge nested flags/site flags without losing siblings; special object
  keys are treated as data; invalid site regexes fail closed; Referrer-Policy
  implements the complete recognized-token/redirect/downgrade behavior; and
  request/response header normalization uses null-prototype records with safe
  singleton and multi-value handling.
- **Synchronous and worker RPC reliability.** The synchronous XHR response
  frame survives `SharedArrayBuffer` growth and rejects truncated frames.
  Client/worker RPCs have bounded timeouts and sender/type checks. WASM fetches
  verify HTTP success, stale pooled rewriters are freed safely, source hashing
  is reproducible, and generated-worker payloads are no longer needlessly
  rebuilt.
- **Nested Service Worker emulation.** Registrations are now same-origin and
  scope validated, stored independently, longest-scope matched, exposed with
  usable registration/active objects, and actually removed on `unregister()`.
  `ready`, `controller`, `getRegistration()`, and `getRegistrations()` follow
  their multi-registration semantics. Fetch RPCs time out instead of hanging;
  transferred request metadata, `respondWith`, and `waitUntil` are represented;
  and page-to-worker `postMessage` (including transferables) reaches the nested
  runtime.
- **DOM and language traps.** Compound/logical assignment operators preserve
  evaluation semantics; object-form event listeners work; storage proxies keep
  stable identity and correct `storageArea`; namespace-aware attribute APIs,
  `setAttributeNodeNS`, and every mutating `NamedNodeMap` sibling now go through
  rewriting; the internal `sherpa-attr-*` namespace can no longer be overwritten
  through public setters.
- **Request compatibility.** Fetch/download failure paths settle reliably,
  WebSocket event order no longer lets one throwing property handler suppress
  other listeners, and both `WebSocket`/`WebSocketStream` now resolve relative
  URLs against the virtual document, normalize HTTP(S) schemes, validate
  fragments/subprotocols/close arguments, and pass stream options correctly.
  Cookie prefix rules, header propagation, and several hostile-rejection paths
  were hardened in the same sweep.
- **Build and release integrity.** CI permissions and triggers were tightened,
  pnpm and commit metadata are reproducible, workflow/shell validation is
  explicit, static serving has containment checks, packaging validates every
  export/artifact/map/type, and a tracked generated Cargo lockfile was removed.

Current validation: **124 unit assertions**, ESLint, full TypeScript `--noEmit`,
Rslib declarations, both production Rspack bundles (using the exact generated
WASM glue recovered from a successful CI artifact), workflow lint, and all six
package-validation checks pass. A live Playwright run remains unavailable in
this sandbox because no browser binary is installed and its browser CDN is not
reachable; this is an environment limitation, not a skipped local failure. No
Rust source or committed WASM binary changed.

### Hot-path pass: rewrite-metadata resolution, page-facing DOM traps, internal query namespace

The previous performance work targeted the service worker. This pass targets
the **page realm**, where the same shared rewriters run against a `URLMeta`
whose `origin`/`base` are accessors — each read decodes the proxied
`location.href` and runs a `querySelector("base")` on the document. Reading
them once per URL touched, as the rewriters did, made that cost scale with
page content.

Fixed bugs (each one reproducible, not theoretical):

- **`<base href>` in client-rewritten markup threw and silently disabled
  rewriting.** `traverseParsedHtml` assigns `meta.base` when it meets a
  `<base>`; the client's meta is getter-only, and the bundle is strict mode,
  so the assignment threw `TypeError: Cannot set property base ... which has
only a getter`. `innerHTML`/`insertAdjacentHTML`/`DOMParser`/`document.write`
  catch and fall back to the **unrewritten** markup (URLs unproxied);
  `outerHTML` threw into page code. `rewriteHtml` now resolves the caller's
  meta into its own mutable object (`snapshotMeta`, `src/shared/urlMeta.ts`)
  before traversing.
- **A malformed `<base href>` took the whole page's rewriting down.**
  `client.meta.base` did a bare `new URL(href, ...)`, which throws for `//`,
  `http://` or a leftover template placeholder — out of a getter that every
  URL rewrite reads. Now uses the same `resolveBaseHref` helper the worker
  does and ignores an unresolvable base, per HTML.
- **Sherpa's internal query parameters collided with site parameters.** The
  engine claimed the bare names `type`, `dest`, `scope`, `from`, `topFrame`
  and `parentFrame` on proxied URLs, and the worker consumed anything under
  them. A GET form with a `type` select or a `from` date field lost that
  field before the upstream request, and a page URL carrying
  `?dest=serviceworker` made the client boot as an emulated service worker.
  All six now live under a `sherpa.` namespace, defined once in
  `src/shared/internalParams.ts`; everything outside it is the site's and is
  passed through.
- **A null rewriter source map discarded a successful rewrite.**
  `Array.from(res.map)` threw on it, and the catch (with `allowInvalidJs`,
  which defaults on) handed the page its **original, unproxied** script.
- **`element.attributes` had no identity.** A fresh `Proxy` per read, so
  `el.attributes !== el.attributes`. Now one wrapper per map.
- **`RawTrap` clobbered its receiver on re-entry.** The per-trap `ctx` is
  shared across calls for allocation reasons but `ctx.this` was never
  restored, so a trap body that re-entered the same trap left the outer call
  operating on the inner call's object. Saved and restored now.

Performance (measured; `bench/regression.mjs`, added in this pass, A/Bs the
working tree against any git ref through the existing `BENCH_BASELINE_REF`
bundling):

- **Meta accessor reads collapse**: 1611 → 2 per corpus `article.html`,
  194 → 2 per corpus `site.css`. Realm-independent count; in a page each of
  those was a proxied-URL decode + a `<base>` DOM query.
- **`unrewriteHtml` ~90×** on markup with no `sherpa-attr-*` attributes —
  i.e. the common `element.innerHTML` read, which used to round-trip through
  htmlparser2 + dom-serializer unconditionally. It also stops handing pages
  back re-serialized markup instead of their own.
- Worker-realm rewrite throughput unchanged (that realm's meta was already a
  plain object); the page-realm harness numbers are a floor, since a Node
  stub cannot simulate `querySelector`.
- **Inline source maps ~2× smaller.** In the SW path the map was serialized
  into every rewritten script as a decimal array literal (~2.6 characters
  per byte, and the page's JS parser had to materialize the array); it is
  base64 now (~1.33). Same map, and in-realm pushes hand over the rewriter's
  `Uint8Array` directly instead of copying it through an `Array` of numbers.
- `Error.prepareStackTrace` is no longer rebuilt as a fresh closure on every
  proxied call; `base64` uses `Uint8Array.fromBase64`/`toBase64` where the
  engine has them (the ~534 KiB WASM decode in every document's boot);
  `natives.call` uses `Reflect.apply` instead of re-spreading its rest array;
  the hot `Element.prototype` attribute natives are captured once instead of
  re-entering the `natives.store` Proxy per call; `flagEnabled` no longer
  allocates a key array per call; and the worker's per-response destination
  and MIME lookups are hoisted `Set`s rather than rebuilt array literals.

Not addressed here, and still the top of `bench/bottleneck/README.md`:
response caching and streaming HTML rewriting. Both are architectural and
network-bound rather than engine-CPU.

### Response caching pass — the top bottleneck, plus hot-path and compat fixes

`bench/bottleneck/README.md` ranked "nothing is ever cached" as the largest
real-world cost, and it is now fixed for everything except documents.

- **Rewritten-response cache** (`src/shared/httpCache.ts` policy,
  `src/worker/cache.ts` storage, new `responseCache` flag, default on). A
  service worker's synthesized responses are never kept in the browser's HTTP
  cache and the transport has none, so every navigation re-downloaded _and_
  re-rewrote every subresource forever. Sherpa now stores the **rewritten**
  response in the Cache API, so a hit skips the transport and the rewriter
  both. Freshness follows `max-age` → `Expires` → RFC 9111 heuristic (a tenth
  of the `Last-Modified` age, capped at a day), minus any upstream `Age`;
  `no-store` never stored, `no-cache` stored-but-always-revalidated, stale
  entries revalidated with `If-None-Match`/`If-Modified-Since` and a `304`
  replays the stored rewrite. Refused: non-`200`, non-`GET`, `Set-Cookie`,
  `Vary` on anything unreproducible (`Cookie`, `User-Agent`, `*`),
  `Authorization`/`Range`/page-supplied conditional requests, bodies >5 MiB.
  The key folds in destination + module-ness + the reproducible `Vary`
  headers; the bucket name embeds a config fingerprint so `modifyConfig`
  starts clean. Bucket is FIFO-trimmed at 500 entries.
  - **Documents are deliberately not cached**: `rewriteHtml` injects a
    cookie-jar snapshot (`self.COOKIE = …`) into every proxied document, so a
    replayed document could boot the client against a stale session. Fixing
    that needs the jar out of the injected HTML first — that is the next step
    if document caching is ever wanted.
  - The lookup runs _after_ the `request` event is dispatched, so an embedder
    listening on it still sees every request and can still override one.
- **Verified end-to-end in a real browser** — `bench/cache-e2e.mjs` (new).
  Every phase runs in a _freshly opened page_ against a _different document_ of
  the same site, because a repeat navigation inside one page proves nothing:
  the renderer's own memory cache also holds service-worker responses for the
  life of the process. (That is exactly how the first version of this harness
  fooled itself — the "cached" result reproduced with the engine cache emptied.)
  With the cache on, the script, stylesheet, vendor bundle and image reach the
  origin **zero** times; flipping `responseCache` off brings all of them back,
  which is what attributes the hit to the engine. The `no-cache` script is
  revalidated (one conditional request, `304`) rather than re-downloaded, the
  document is always re-fetched, and the page works in both modes.
  - Timing, over the harness's shaped link (60 ms RTT / 10 Mbit/s), each sample
    the first proxied navigation of a fresh page: **1.5-1.7x** (two runs:
    394.5 -> 258.6 ms, 399.3 -> 231.5 ms). Unshaped on localhost the same A/B is **1.03×** — the per-page
    setup floor (~190 ms) swamps the ~15 ms of rewriting a hit saves, and the
    download it removes is free there. Report the shaped number; the localhost
    one is a floor, not a result.
  - Cost: **+1.9 KiB gzipped** on `sherpa.all.js` (75,435 → 77,333).
  - Note: `openCache()` memoizes the `Cache` handle, and a `Cache` object keeps
    working after `caches.delete()` by design, so an external cache clear does
    not take effect until the worker restarts. Left as is (every SW caching
    example memoizes); worth knowing when testing.

Other work in the same pass:

- **Cookie persistence left the response path** (`src/worker/cookiePersistence.ts`).
  Every response carrying a `Set-Cookie` used to serialize the whole jar,
  `JSON.parse` it back into an object, and _await_ an IndexedDB transaction
  before the response reached the page. Writes are coalesced now (at most one
  in flight, one queued), the jar is stored as its JSON text rather than
  round-tripped through a parse, and the response path fires and forgets while
  the message handler — which has `event.waitUntil` — still awaits.
- **Source-map decoding is lazy** (`src/client/shared/sourcemaps.ts`,
  `singletonbox.ts`). Every rewritten script pushed its map as its first
  statement and `decodeRewrites` ran there, allocating one object per rewrite —
  tens of thousands for a large minified bundle — on the critical path, for a
  table only `Function.prototype.toString` ever reads. The raw payload is kept
  and decoded on first use. A corrupt map can no longer throw out of the script
  that pushed it either.
- **Runtime `modifyConfig` never reached the running service worker**
  (`src/controller/controller.ts`). `init()`/`modifyConfig()` posted the
  `loadConfig` message to `navigator.serviceWorker.controller`, which is null
  whenever the _controller page itself_ is not controlled by the worker — the
  ordinary first load after `register()` (nothing calls `clients.claim()`), and
  any host page outside the worker's scope. `bench/cache-e2e.mjs` prints this:
  `first page is controlled by the worker: false`. Since the worker's
  `loadConfig()` returns early once it holds a config, nothing else ever
  re-read it, so every runtime change — error-page theme, feature flags,
  prefix, codec, i.e. the whole advertised customization story — silently
  failed to apply until the browser restarted the worker. There is now a
  `notifyWorker()` that falls back to the active worker of the page's own
  registration. Same trust boundary: the worker authenticates the message by
  the sending client's URL (`isTrustedControllerClient`), not by whether it is
  controlled.
- **`<a target="_top">` in server-rewritten markup navigated the wrong frame**
  (`src/shared/htmlRules.ts`). `_top`/`_parent` are retargeted at the real
  frame's name, but `URLMeta` carries no frame names in the service worker (and
  nothing has ever set the `topFrame`/`parentFrame` params), so the rule
  returned `undefined`, which serialized as `target=""` — i.e. `_self`. The
  keyword is preserved when the names are unknown.
- **`document.querySelector` attribute-selector loosening was not global**
  (`src/client/dom/document.ts`). The `[href^="https://…"]` → `[href*=…]`
  rewrite had no `g` flag, so in a selector list only the first one was
  loosened and the rest silently stopped matching.
- **`Performance.getEntries*` filtering stopped decoding every entry**
  (`src/client/dom/performance.ts`). It read the _trapped_ `entry.name`, which
  unrewrites a proxied URL, purely to compare against Sherpa's own file paths,
  and rebuilt that path list per entry. Reads the native name and hoists the
  list now.
- **`@/shared`'s config state moved into a leaf module** (`src/shared/state.ts`,
  re-exported so no call site changed). `@/shared` exported `config` _and_
  `export * from "./rewriters"`, while the rewriters import `config` from
  `@/shared` — a real cycle. Same for `src/types.ts`, which value-imported the
  controller, client and worker entry points (two of them entirely unused) to
  name types, making `@/types` a runtime edge into the whole engine from leaf
  modules like `@/shared/security/db`. All type-only now.

Validation: **176 unit assertions** (37 new across `httpCache`,
`responseCache` — which exercises the real `src/worker/cache.ts` against a fake
`CacheStorage` — and `cookiePersistence`), ESLint, full TypeScript `--noEmit`,
the production Rspack build, and the browser run above. `tests/unit/helpers/srcResolver.mjs`
is new: an ESM resolve hook that teaches `node --test` the `@/` aliases and
extension-less specifiers, so engine modules can be tested directly instead of
through a copy of their logic.

### Client-runtime hot-path pass + selector, request and event correctness

Everything measured before this pass was service-worker-side. This one went
after the _other_ half of a proxy's cost — what a page pays while its own
JavaScript runs — and picked up a set of real compat bugs on the way. New
harness: `bench/client-hotpath.mjs` runs workloads **inside a real proxied
document** in Chromium and A/Bs two dists
(`SHERPA_BASELINE_DIST=/path/to/dist`); numbers and the structural diagnosis
live in `bench/bottleneck/README.md` §6. Medians vs the pre-pass build:
URL-valued `setAttribute` **4.4×**, `addEventListener`/`removeEventListener`
**6.7×**, `element.attributes` iteration **23.5×**, wrapped local identifiers
**55×**, `dispatchEvent` 1.4×; full proxied navigation flat (0.98–1.04× across
runs, i.e. noise — it is the control here), and the
shared rewriters unchanged-to-slightly-faster on `bench/regression.mjs`
(`rewriteHtml` 1.02–1.06×).

Performance:

- `client.meta.base` ran `document.querySelector("base")` on **every URL the
  page rewrote** — a whole-document traversal whenever the page has no
  `<base>`, which is almost all of them, making URL rewriting O(nodes) per
  URL. Now a live `HTMLCollection` (the browser maintains and invalidates it,
  so this is not a staleness trade) plus memoized resolution on (href,
  document URL).
- `client.eventcallbacks` was a strong `Map<EventTarget, Entry[]>`: O(n) scan
  per registration _and_ a hard reference to every element that ever received
  a listener, for the life of the realm. Now a `WeakMap` keyed by target then
  by the page's own callback.
- The `element.attributes` proxy computed `Object.keys(proxy)` per index read,
  re-entering its own `ownKeys`/`has` traps and allocating a key array each
  time. Replaced with a direct native scan; indices are also dense now, and
  `getOwnPropertyDescriptor`/`ownKeys` agree with `length`.
- `wrapfn` read `location`, `eval`, `parent` and `top` off the window on every
  call — the last two walk the frame tree — even for primitives, which
  minified code produces constantly (`top`/`parent` are ordinary local names).
  Primitives now return immediately; the two `indirectEval` bindings are built
  once instead of per read.
- `getInjectScripts` re-serialized the whole config and re-base64'd the boot
  script for every document and iframe; both are memoized.
- `traverseParsedHtml` walked each element's attributes twice; merged into one
  pass, and `isEventAttribute` rejects on two character codes before
  lowercasing.

Correctness (each covered by `tests/behavior/`, which asserts from inside the
proxied page):

- **Attribute selectors matched nothing.** `a[href^="/help/"]`,
  `img[src$=".svg"]`, `[href="…"]` — a proxied element's `href` holds the
  rewritten URL, so none of them could hit. The old mitigation (loosen `^=`
  to `*=`) could not work with the default codec either, since the rewritten
  value is percent-encoded and no longer contains the site's URL as a
  substring. New `src/shared/selectors.ts` rewrites each attribute selector to
  `:is([sherpa-attr-name…],[name…])`, so the authored value is matched with
  the operator the site wrote. Applied to `Element.prototype` and
  `DocumentFragment.prototype` too — only `Document.prototype` was trapped, so
  `el.querySelectorAll(…)` was broken outright.
- **`fetch(x)`/`new Request(x)` escaped the proxy** for any `x` that is
  neither a string nor a `URL`. WebIDL stringifies those (an `<a>` element, a
  URL-like wrapper), so the request left for the site's real origin.
- **URL rewriting was not idempotent.** DOM stringifiers read the _attribute_,
  not the trapped property, so `String(anchor)` and `fetch(anchor)` yield an
  already-rewritten href; encoding it twice produced a URL whose inner target
  was the proxy, which the worker then rejected as a same-origin fetch.
- **`document.baseURI` leaked the proxy origin.** It read `base.href`, the
  reflected property the browser had already resolved against the proxied
  document's URL. Resolves the authored attribute against the real URL now.
- **`window.event` was pinned to the first event ever dispatched** — the
  accessor closed over one invocation's arguments behind an `if (!self.event)`
  guard, and ran `defineProperty` on the global per dispatch until then.
- **Non-ASCII inline scripts mojibake'd** when read back through `innerHTML`:
  `unrewriteHtml` used `atob` alone on a source that had been UTF-8 encoded
  before base64.
- `window.open(url, "_top")` opened a window literally named `"null"` whenever
  the frame was already the top of the Sherpa context (same `?? value` fix the
  `target` attribute rule already had).
- `Array.from(el.attributes)` handed the page every `sherpa-attr-*` shadow
  attribute: the map proxy rebound `Symbol.iterator` to the _unfiltered_
  native map.
- Response cache: `storeCachedResponse` buffered the entire body before
  checking the 5 MiB limit, so a chunked response had no bound and an endless
  one was accumulated forever; it reads incrementally and cancels now. Every
  give-up path also cancels its branch of the tee (an abandoned one keeps the
  browser buffering the page's copy). `text/event-stream` is refused outright.
- Removed a dead `responseHeaders["accept"]` check in `worker/fetch.ts` that
  read a _request_ header name out of the response headers.

Selector rewriting sits in front of essentially every DOM query a site makes,
so it carries a fallback: a rewritten selector is validated with the _native_
`Element.prototype.matches` (captured before the trap is installed, or it would
recurse — and `CSS.supports("selector(...)")` is no good here, since it takes a
single complex selector and rejects an ordinary selector list), and anything the
parser refuses falls back to the page's own selector, which is exactly the
pre-pass behavior. Results are memoized per selector string, so the scan and the
validation stay off repeat queries.

`pnpm test:behavior` also runs in CI now, _before_ the live-site Playwright
suite. That suite drives real google.com/youtube.com from GitHub runners and is
flaky by design from datacenter IPs (see `KNOWN_ISSUES.md`); two runs of this
branch's identical commit failed on _different_ tests, each passing on retry in
the other run — which is what flakiness looks like and what a real regression
does not. Putting a hermetic gate ahead of it means an actual engine regression
is reported on its own rather than lost in that noise: the missing local-fixture
gate `KNOWN_ISSUES.md` asks for.

New: `tests/behavior/` (`pnpm test:behavior`) — 34 assertions run inside a
proxied document against the real pipeline (service worker, WASM rewriter,
bare-mux over wisp, local fixture origin). This is the only place the client
traps can be observed as a site sees them; the unit tests can only reach leaf
modules. It found three of the bugs above that code reading had missed, plus a fourth
during the fallback work: `CSS.supports("selector(...)")` silently rejects
selector lists.

**Note on `dist/`:** it is a build artifact but _is_ tracked. The bundle
embeds the WASM rewriter, and the wasm-bindgen glue in `rewriter/wasm/out/`
must come from the same rewriter build as `dist/sherpa.wasm.wasm` — pairing a
glue from one build with a binary from another does not fail loudly, it
silently disables JS rewriting (the behavior suite catches it: the `location`
trap check fails while everything else passes). Always `RELEASE=1 pnpm
rewriter:build` before `pnpm build` when regenerating dist.

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
