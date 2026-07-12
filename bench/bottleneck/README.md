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

In the SW path the sourcemap is prepended to **every script** as a decimal
array literal (`js.ts` — the `pushsourcemapfn` global never exists in the
worker), which the client then parses and keeps in `client.box.sourcemaps`
for the life of the realm. On a localhost fixture this is invisible (the
A/B measured no difference); on a real link it's +40% script download on
the critical path, plus memory that never gets evicted. The doubled HTML
also roughly doubles renderer `ParseHTML` time (56 ms for the 80→161 KiB
article).

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

### 6. Cold start: ~590 ms (not the main pain)

`controller.init` 17 ms + SW install 45 ms + `setTransport` 42 ms + first
navigation 302 ms (epoxy WASM init + engine first-fetch setup + first page
pipeline) ≈ 586 ms wall. At parity with upstream; a session pays it once.

## What this means for priorities

The engine-vs-engine work (rewriter throughput, per-request IDB/PSL) is
done and won — Sherpa beats its upstream on every micro number. What
bottlenecks Sherpa _as a product_ is now architectural, shared with the
upstream design it forked:

1. **Add a rewritten-response cache** (Cache API in the SW) — biggest
   real-world win, self-contained, kills repeat network _and_ repeat CPU.
2. **Fix the client boot decode path** (~30 of the ~45 ms per document is
   one bad base64→bytes loop; the payload-as-script design costs the rest).
3. **Stop shipping sourcemaps inline by default** (+43% on every script).
4. **Stream (or early-flush) the HTML rewrite** — the hard one; the only
   fix for time-to-first-byte on heavy documents.

Caveats: fixtures are single-origin (no PSL/cross-origin emulation cost in
these numbers), the shaped link is a simple per-response latency+bandwidth
model at the origin (both paths shaped identically), and the client-side
Proxy/trap tax on page JS _execution_ (every rewritten global access) is
not measured here — it needs a JS-heavy interactive workload rather than a
page-load harness, and is the natural next measurement.
