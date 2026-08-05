# What actually bottlenecks Sherpa

The main [`bench/`](../README.md) suite answers "is Sherpa faster than the
Scramjet 1.x it forked?" (yes, 1.35×+ e2e). This directory answers the next
question: **where does a Sherpa-proxied page load actually spend its time,
and what does proxying cost against not proxying at all?** Everything below
was measured with the two harnesses here, driving the committed `dist/`
through the real pipeline (service worker, WASM rewriter, bare-mux + epoxy
over wisp, Chromium 141):

- `rewrite-cost.mjs` — the real rewriters in Node (the published micro bench
  stubbed the WASM JS rewriter and disabled `sourcemaps`; this uses both as
  shipped, via `dist/sherpa.bundle.js`).
- `e2e-phases.mjs` — full browser loads: direct vs proxied on the same
  fixtures, per-request attribution inside the SW (instrumented `sw.js`
  wrapping `engine.fetch` and `engine.client.fetch`), per-document client
  boot cost, a CDP trace, a shaped link (60 ms RTT / 10 Mbit/s), and a
  repeat-visit run against a cacheable origin.

```sh
cd bench && npm i && npm run corpus
node bottleneck/rewrite-cost.mjs
node bottleneck/e2e-phases.mjs      # writes results/bottleneck-*.json
```

## The ranked answer

Localhost hides the two biggest problems. On an unshaped local link a warm
proxied load is a flat **2.0–2.6× a direct load** (~70–100 ms of overhead
per page) — annoying but tolerable. Both structural bottlenecks scale with
network realism and page weight, which fixture benchmarks were built to
factor out:

### 1. Nothing is ever cached (largest real-world cost)

Every proxied response is synthesized by the service worker, and
SW-synthesized responses are **never stored in the browser HTTP cache**.
The transport (epoxy TLS-in-WASM over wisp) has no cache of its own, the
engine never touches the Cache API (zero references in `src/`), and
rewritten output is never memoized. Net effect: **every navigation
re-downloads and re-rewrites every byte**, forever, regardless of upstream
`Cache-Control`.

Measured (cacheable origin, 60 ms RTT / 10 Mbit/s, article.html):

|         | 1st visit        | 2nd visit                               |
| ------- | ---------------- | --------------------------------------- |
| direct  | 269 ms (167 KiB) | **24 ms (0 KiB — HTTP cache)**          |
| proxied | 235 ms           | **230 ms (full re-fetch + re-rewrite)** |

A ~10× repeat-visit gap on a small page, growing linearly with page weight.
Real browsing is dominated by warm assets (fonts, framework bundles, images
shared across pages of a site); Sherpa pays first-visit cost on all of them,
every time — network, oxc rewrite CPU, and sourcemap serialization included.

_Fix direction:_ a Cache API layer in the SW keyed on the final upstream URL,
storing the **rewritten** response (so a hit skips transport _and_ rewriting),
honoring upstream `Cache-Control`/`Vary` conservatively and invalidated on
config change. Self-contained, no engine rewrite required.

> **Done.** `src/shared/httpCache.ts` (policy) + `src/worker/cache.ts`
> (storage), behind the `responseCache` flag, on by default; the rules are
> documented in the repository README under "Response caching". It keys on the
> upstream URL plus the destination, module-ness and the `Vary` headers it can
> reproduce, refuses anything it cannot safely replay (non-200, `Set-Cookie`,
> `Vary: Cookie`, `Authorization`, `Range`, >5 MiB), revalidates stale entries
> with `If-None-Match`/`If-Modified-Since`, and buckets by a configuration
> fingerprint. **Documents are still not cached** — a proxied document embeds a
> cookie-jar snapshot for the client's synchronous `document.cookie`, so
> replaying one could boot a page against a stale session; the table above is a
> document, so its 230 ms row does not move. What moves is everything else on
> the page, which is where repeat-visit weight actually lives.
>
> Verified end-to-end in Chromium by `bench/cache-e2e.mjs`. Each phase runs in
> a **freshly opened page** against a **different document** of the same site:
> a repeat navigation inside one page proves nothing, because the renderer's own
> in-memory cache also holds service-worker responses for the life of the
> process. With the cache on, the fresh script, stylesheet, vendor bundle and
> image reach the origin **zero** times; flipping `responseCache` off brings
> every one of them back, which is what attributes the hit to the engine rather
> than to the browser. The `no-cache` script is revalidated (one conditional
> request, `304`) instead of re-downloaded, the document is always re-fetched,
> and the page executes and styles correctly in both modes.
>
> Timing, same harness, over its shaped link (60 ms RTT, 10 Mbit/s), each sample
> being the first proxied navigation of a fresh page so both sides pay the same
> per-page setup: **1.5–1.7×** (two runs: 394.5 → 258.6 ms, 399.3 → 231.5 ms). Unshaped on localhost the
> same A/B is 1.03× — the fixture's ~190 ms per-page setup floor swamps the
> ~15 ms of rewriting a hit saves, and the download it removes is free there.
> That gap between the two is the point: what this fixes is network and rewrite
> work proportional to page weight and latency, neither of which localhost has.

### 2. Full-response buffering — the document can't stream

`rewriteBody` does `await response.arrayBuffer()` for every HTML document
(and script/style), then a full htmlparser2 parse → traverse →
`dom-serializer` render before the first byte reaches the renderer
(`src/worker/fetch.ts`, `src/shared/rewriters/html.ts`). A real browser
starts parsing and preloading subresources after the first network chunk;
behind Sherpa the page sees byte 0 only after the **entire** document has
crossed the transport and been rewritten — so subresource fetching starts
late too.

Measured (60 ms RTT / 10 Mbit/s):

| page                              | direct load (doc TTFB) | proxied load (doc TTFB) |
| --------------------------------- | ---------------------- | ----------------------- |
| landing.html (5 KiB)              | 194 ms (50 ms)         | 208 ms (57 ms)          |
| article.html (80 KiB)             | 279 ms (50 ms)         | 287 ms (**126 ms**)     |
| big page (1.2 MiB + 1 MiB script) | 1160 ms (51 ms)        | **2322 ms (1207 ms)**   |

The time-to-first-byte penalty is exactly the document's download time and
grows linearly with size ÷ bandwidth: a 1.2 MiB document over 10 Mbit/s
means **1.2 s of blank page before the browser sees a single byte**, and 2×
total load time. (Upstream Scramjet 1.x has the identical architecture, and
its 2.x line moved to a streaming rewriter largely because of this.)

_Fix direction:_ streaming or chunked HTML rewriting (flush `<head>` +
rewritten chunks as they arrive). This is the hardest item on the list —
htmlparser2 can stream, but the current rewriter round-trips a full DOM.
Even a two-phase "flush injected head early" would let the runtime boot in
parallel with the body download.

### 3. Per-document client boot: ~45–60 ms of serial main-thread work

Every proxied document (including every iframe) loads three parser-blocking
injected scripts before any page content runs. Measured warm (CDP trace +
in-page micro):

| phase                                                                                        | cost                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| parse/eval the WASM payload script (a **695 KiB** base64 literal)                            | ~10 ms (0.2 ms once V8 code-caches it)      |
| `Uint8Array.from(atob(WASM), cb)` in the client boot (per **byte** JS callback over 534 KiB) | **~32 ms**                                  |
| `sherpa.all.js` parse+eval                                                                   | ~3 ms                                       |
| `loadAndHook` (hook installation, includes the decode above)                                 | **44 ms total** (data: script in the trace) |
| first `WebAssembly.Module` compile in the realm (lazy, latched)                              | ~0.5 ms                                     |

That's the single biggest main-thread block in a warm proxied load
(ParseHTML aside) and it repeats for **every document and iframe**. The
per-byte `Uint8Array.from` mapper alone is ~32 ms of it — a plain indexed
`charCodeAt` loop or `Uint8Array.fromBase64` (Chrome 140+) is roughly an
order of magnitude faster; better still, fetch the payload as an
`ArrayBuffer` instead of embedding 695 KiB of base64 into a `<script>` the
renderer must also parse.

> **Partly addressed since this was measured.** The per-byte mapper is an
> indexed `charCodeAt` loop now, and `base64ToBytes` uses
> `Uint8Array.fromBase64` where the engine has it (Chrome 140+, Safari 18.2+),
> which is roughly another order of magnitude. What remains is the design
> itself: 695 KiB of base64 embedded in a `<script>` the renderer must parse,
> once per document. Fetching the payload as an `ArrayBuffer` instead is
> still the real fix, and is not done.

### 4. Wire inflation: rewritten HTML is 2–2.5×, JS +43% under default flags

From `rewrite-cost.mjs` (real rewriters, default `SherpaController` flags —
note `sourcemaps` **defaults to true**):

| input                                  | output size         | notes                                                             |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| landing.html 5.4 KiB                   | 13.6 KiB (**2.5×**) | injected boot scripts dominate small docs                         |
| corpus spa.html 144 KiB (script-heavy) | 369 KiB (**2.6×**)  | base64 shadow copy of every inline script + rewrite growth + maps |
| corpus article.html 327 KiB            | 519 KiB (1.6×)      |                                                                   |
| real minified bundle 176 KiB, maps on  | 252 KiB (**1.43×**) | map serialized as a decimal `[104,101,…]` literal per script      |
| same, `sourcemaps: false`              | 181 KiB (1.03×)     | and ~25% less rewrite CPU                                         |

In the SW path the sourcemap is prepended to **every script** (`js.ts` — the
`pushsourcemapfn` global never exists in the worker), which the client then
parses and keeps in `client.box.sourcemaps` for the life of the realm.

> **Partly addressed since this was measured.** The map used to be serialized
> as a decimal array literal (~2.6 characters per map byte, which the page's
> JS parser then had to materialize as an array). It is base64 now (~1.33
> characters per byte) — about **half** the bytes, parsed as a single string
> — so the `1.43×` row above reads closer to `1.2×` today. The map is still
> on the critical path, so the fix direction below still stands. On a localhost fixture this is invisible (the
> A/B measured no difference); on a real link it's +40% script download on
> the critical path, plus memory that never gets evicted. The doubled HTML
> also roughly doubles renderer `ParseHTML` time (56 ms for the 80→161 KiB
> article).

_Fix direction:_ default `sourcemaps` off (it exists to make
`Function.prototype.toString` fidelity work — a compat nicety, not a
correctness requirement), or move the map off the critical path (side
request keyed by scramtag instead of an inline literal).

### 5. Per-request SW pipeline overhead, serialized on one thread

Warm, unshaped, medians per request (`sw total` = whole `handleFetch`;
`transport` = time-to-headers over wisp/epoxy; the difference is engine
work + body buffering, which is ~pure engine CPU on localhost):

| class    | sw total    | transport | engine+buffer |
| -------- | ----------- | --------- | ------------- |
| document | 5.6–12.7 ms | ~3–4 ms   | 2.4–8.8 ms    |
| script   | 6.3–16.4 ms | ~4–6 ms   | 2–11 ms       |
| style    | 13–15 ms    | ~5–6 ms   | 8.5–10 ms     |
| image    | 6.6–9.2 ms  | ~5–7 ms   | 1.2–3.6 ms    |

Even a pure-passthrough image pays 1–4 ms of security emulation, header
rewriting, and response plumbing — ×26 images on the gallery fixture ≈
60–90 ms of work **serialized on the single SW event loop** (the style
numbers are high partly because they queue behind everything else; CSS
rewriting itself is ~0.4 ms). The big fixture puts the ceiling on display:
a 1.2 MiB document costs ~139 ms inside the SW and a 1 MiB minified bundle
~95 ms (oxc runs at ~30–40 MiB/s, sourcemap serialization included). While
those run, every other response on the page waits.

_Fix direction:_ response caching (#1) removes most repeat cost; beyond
that, memoizing per-origin emulation state further, and eventually moving
rewrites off the SW dispatch loop.

### 6. Client-side trap tax: what the page pays while it runs

Everything above is per-_resource_ cost. This one is per-_operation_: a
proxied page runs its JavaScript against Sherpa's traps, so the bill scales
with how much the site does, not with how big it is — which is exactly why a
page-load harness cannot see it. `client-hotpath.mjs` (repo root:
`node bench/client-hotpath.mjs`) runs workloads inside a real proxied
document and A/Bs two dists.

Four structural costs were found and removed. Medians in Chromium, this tree
against the pre-fix build, n=9 alternating rounds:

| workload                                         | before   | after  | speedup   |
| ------------------------------------------------ | -------- | ------ | --------- |
| 20 000 URL-valued `setAttribute`                 | 587 ms   | 134 ms | **4.4×**  |
| 4 000 `addEventListener` + `removeEventListener` | 130 ms   | 19 ms  | **6.7×**  |
| 20 000 `element.attributes` walks                | 6 677 ms | 284 ms | **23.5×** |
| 300 000 wrapped local identifiers                | 248 ms   | 4.5 ms | **55×**   |
| 30 000 `dispatchEvent`                           | 66 ms    | 46 ms  | 1.4×      |
| first proxied navigation                         | 323 ms   | 330 ms | 0.98×     |

The navigation row is the control: nothing here was supposed to move it, and
across runs it lands between 0.98× and 1.04× — run-to-run noise. These
workloads are synthetic hot loops, so read the multiples as "this cost is
gone", not as a prediction for any particular site.

What each was:

- **Resolving the document base ran `querySelector("base")` per rewritten
  URL** — and when a page has no `<base>` (almost all of them) that is a full
  document traversal, so URL rewriting was O(nodes) per URL. It reads a live
  `HTMLCollection` now, which the browser maintains and invalidates itself,
  and the resolution is memoized on (href, document URL).
- **The listener registry was a strong `Map<EventTarget, Entry[]>`.** Two
  problems in one: registering the n-th listener on a target scanned the
  other n−1, and every element that ever received a listener was retained for
  the life of the realm. It is a `WeakMap` keyed by target, then by the
  page's own callback.
- **`element.attributes` index access rebuilt `Object.keys(proxy)`** — which
  re-entered the proxy's own `ownKeys`/`has` traps and allocated a key array
  _per index read_, making the ordinary `for (i < attributes.length)` loop
  quadratic with an allocation per step.
- **The wrap function read four window properties on every call**, two of
  which (`parent`, `top`) walk the frame tree. Minified code reuses `top` and
  `parent` as ordinary local names, so this ran constantly on values that
  could not possibly be any of them. Primitives now return immediately.

### 7. Cold start: ~590 ms (not the main pain)

`controller.init` 17 ms + SW install 45 ms + `setTransport` 42 ms + first
navigation 302 ms (epoxy WASM init + engine first-fetch setup + first page
pipeline) ≈ 586 ms wall. At parity with upstream; a session pays it once.

## What this means for priorities

The engine-vs-engine work (rewriter throughput, per-request IDB/PSL) is
done and won — Sherpa beats its upstream on every micro number. What
bottlenecks Sherpa _as a product_ is now architectural, shared with the
upstream design it forked:

1. ~~**Add a rewritten-response cache** (Cache API in the SW)~~ — **done**,
   for every destination except documents; see the note under §1.
2. **Fix the client boot decode path** — the decode itself is fixed
   (`Uint8Array.fromBase64`, indexed fallback); what remains is the design:
   695 KiB of base64 in a `<script>` the renderer parses once per document.
   Fetching the payload as an `ArrayBuffer` is the real fix and needs the
   synchronous-`getRewriter` requirement solved first.
3. **Stop shipping sourcemaps inline by default** (+~20% on every script
   since the base64 change). Decoding them is no longer on the critical path
   — the table is materialized on the first `Function.prototype.toString`
   that needs it rather than in every script's first statement — but the
   bytes are still on the wire.
4. **Stream (or early-flush) the HTML rewrite** — the hard one; the only
   fix for time-to-first-byte on heavy documents, and now the largest
   remaining item. Untouched: `rewriteBody` still buffers the whole document
   before the renderer sees byte 0.
5. **Cache documents too**, which needs the cookie-jar snapshot out of the
   injected document HTML first.

Caveats: fixtures are single-origin (no PSL/cross-origin emulation cost in
these numbers), and the shaped link is a simple per-response latency+bandwidth
model at the origin (both paths shaped identically). The client-side trap tax
on page JS _execution_ used to be the missing measurement here; it now has
its own harness (§6), though its workloads are synthetic hot loops rather
than a recorded real-site session.
