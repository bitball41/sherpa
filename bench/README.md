# Sherpa vs Scramjet — performance benchmarks

> Looking for _what bottlenecks Sherpa itself_ rather than how it compares
> to upstream? See [`bottleneck/`](bottleneck/README.md) — phase attribution
> for full proxied page loads (direct-vs-proxied, per-request SW timing,
> client boot cost, shaped-network and repeat-visit runs) with a ranked
> list of the remaining structural costs.

Reproducible benchmarks comparing Sherpa against **upstream Scramjet 1.x**,
the engine Sherpa forked from. Two baselines are used, and they are the same
code (upstream's v1 line is frozen):

- **Source baseline** — commit `57ba89e`, the exact upstream commit Sherpa
  forked at, materialized as a git worktree (`.upstream/`). Used for the
  micro benchmarks so both engines are bundled by the same bundler, run on
  the same VM, and differ **only** in engine code.
- **Artifact baseline** — the published `@mercuryworkshop/scramjet@1.1.0`
  dist (npm `latest` == `legacy` tag). Used for the end-to-end browser
  benchmark and the wire-size comparison, so Scramjet is measured exactly as
  it ships.

## Running

```sh
cd bench
npm i             # installs esbuild + @mercuryworkshop/scramjet@1.1.0
npm run corpus    # generate the deterministic fixture corpus (seeded PRNG)
npm run build     # bundle Sherpa (../src) + upstream (.upstream/src) rewriters
npm run micro     # rewriter throughput, interleaved A/B, medians + win rates
npm run size      # wire cost: raw/gzip/brotli of every runtime artifact
npm run e2e       # full-pipeline page loads in Chromium via Playwright
node cache-e2e.mjs # response-cache behavior + warm repeat-navigation A/B
BENCH_BASELINE_REF=<commit> npm run build && npm run verify
                  # byte-equivalence of rewriter output vs a pinned commit
BENCH_BASELINE_REF=<commit> npm run build && npm run regression
                  # this tree vs a pinned commit: did my change actually help?
node ../bench/client-hotpath.mjs
                  # client-side trap cost inside a real proxied page
npm run tailwind  # drive the real @tailwindcss/browser build through the pipeline
```

Raw results land in `results/*.json` (git-ignored) with environment metadata.

## Methodology

**Micro benchmark (`micro.mjs`)** — measures the shared rewriter pipelines
(HTML, CSS, URL) that run on every proxied page:

- Both variants are bundled from source by esbuild and run in the **same
  Node process**, so V8 version, GC, and machine state are common-mode.
- The WASM JS rewriter is replaced by an **identical stub on both sides**
  (Sherpa and Scramjet 1.x build it from the same code, so it is
  common-mode; the e2e benchmark exercises the real one).
- Identical config on both sides: same proxy prefix, codec, flag values, and
  injected-global names — all config-driven in both engines.
- Iterations are interleaved in alternating blocks (order rotates per round)
  so thermal/frequency drift cannot systematically favor either side; 10
  warmup iterations are discarded; n=60 samples per case per variant.
- Reported: median (robust to GC outliers), p95, MiB/s, and the win rate
  over round-matched sample pairs.
- Fixtures: a seeded deterministic corpus (byte-identical on every machine)
  modeled on common page archetypes, **plus real captured pages** (Wikipedia
  article, MDN reference page) dropped into `fixtures-live/` as a realism
  check. Both fixture families agree.

**Client hot paths (`client-hotpath.mjs`)** — every harness above measures
the _service worker_ side. This one measures what a proxied page pays while
its own JavaScript runs: trapped DOM calls and wrapped global accesses, a cost
proportional to how much the site does rather than how big it is, and
therefore invisible to a page-load benchmark.

- Runs from the repository root, driving the committed `dist/` through the
  real pipeline in Chromium (`node bench/client-hotpath.mjs`).
- Workloads execute **inside the proxied document**, so every trap is live:
  URL-valued `setAttribute`, `addEventListener`/`removeEventListener` churn,
  `element.attributes` iteration, wrapped local identifiers, event dispatch,
  and a full proxied navigation.
- `SHERPA_BASELINE_DIST=/path/to/dist` adds a second, identical proxy host
  serving another build. Both engines are then run in alternating blocks
  (direction rotates per round) with a discarded warmup per workload, and the
  medians are reported side by side with a speedup column.
- Build a baseline dist from any commit with a worktree:
  `git worktree add /tmp/base <ref> && (cd /tmp/base && npm run build)`.

**End-to-end benchmark (`e2e/`)** — the number that actually matters: wall
time for a full proxied page load in a real browser.

- Chromium via Playwright, driving each engine's **real shipped pipeline**:
  service worker, WASM JS rewriter, bare-mux + epoxy transport (identical
  builds for both engines), wisp server, and a local deterministic fixture
  origin — no external network, so the only variable is the engine.
- Timed from `frame.go(url)` to the proxied document's `load` event
  (subresources included) in a persistent frame, matching real usage.
- Loads run in short alternating blocks (fresh browser context per block,
  ABBA order) to cancel drift; cold starts (context + SW install + first
  page) are measured separately in fresh contexts. n=24 warm samples per
  page per engine per run; navigation retries are counted and reported
  (0 in the reported runs).

**Self-regression (`regression.mjs`)** — the other harnesses compare Sherpa
to upstream. This one compares Sherpa to _itself_ at any pinned commit, and
splits each case by realm, which matters because the shared rewriters run in
two very different ones: in the service worker `URLMeta` is a plain object
built per request, while in a proxied page `origin`/`base` are accessors that
decode the proxied location and query the document for `<base>` on every
read. It also reports how many times each variant reads those accessors per
stylesheet and per document — a realm-independent count, and the honest
number, since a Node harness cannot simulate `querySelector` and so
understates the browser cost of every read it saves.

**Framework check (`tailwind.mjs`)** — not a benchmark: a pass/fail check that
a real framework survives the pipeline. It serves the published
`@tailwindcss/browser` bundle from the fixture origin and loads a page whose
styles exist only as Tailwind classes, so the assertions can only pass if
Tailwind read its own `<style type="text/tailwindcss">` input intact, compiled
utilities by scanning the proxied DOM, injected the result, and had the `url()`
in its output rewritten to reach the site. Against the build before the
non-CSS-`<style>` fix it reports 2/6 — Tailwind compiles nothing at all,
because its `@import "tailwindcss"` had been rewritten into an absolute URL it
refuses.

**Wire cost (`size.mjs`)** — raw/gzip/brotli sizes of every artifact a page
downloads, Sherpa `dist/` vs the published Scramjet dist.

**Response cache (`cache-e2e.mjs`)** — behavioral first, comparative second.
Drives a real Chromium, service worker and transport against a fixture origin
that counts every hit, over a shaped link (60 ms RTT / 10 Mbit/s;
`SHERPA_SHAPE=0` to disable). Every phase runs in a **freshly opened page**
against a **different document** of the same site: a repeat navigation inside
one page proves nothing, because the renderer's own in-memory cache also holds
service-worker responses for the life of the process. It asserts that a fresh
subresource is served without touching the origin, that turning `responseCache`
off brings every one of those requests back (which is what attributes the hit
to the engine rather than to the browser), that a `no-cache` resource is
revalidated with a `304` instead of re-downloaded, that documents are always
re-fetched, and that the page executes and styles correctly either way. Ends
with an A/B where each sample is the first proxied navigation of a fresh page,
so both sides pay the same per-page setup. Set `SHERPA_CHROMIUM` if
playwright's pinned browser build is not the one installed.

**Equivalence (`verify.mjs`)** — the optimizations must not change behavior:
rewriter output is compared byte-for-byte against the pre-optimization
commit across the full corpus, both live pages, and ~60 adversarial edge
cases (10,136 comparisons, 0 divergent).

## Results

Environment: Node v22.22.2 (V8 12.x), Chromium 141, Intel Xeon @ 2.80GHz,
Linux x86_64. Two independent e2e runs shown; micro results are stable
across runs to within a few percent.

### Micro: rewriter throughput (median of 60, lower is better)

| Case                                          |   Sherpa | Scramjet 1.x |   Speedup | Win rate |
| --------------------------------------------- | -------: | -----------: | --------: | -------: |
| rewriteHtml small.html (26 KiB)               |  1.17 ms |      1.83 ms | **1.56×** |      88% |
| rewriteHtml spa.html (144 KiB, script-heavy)  |  2.10 ms |     11.13 ms | **5.29×** |     100% |
| rewriteHtml news.html (210 KiB)               |  7.69 ms |     12.14 ms | **1.58×** |      97% |
| rewriteHtml shop.html (271 KiB, srcset-heavy) | 11.71 ms |     17.45 ms | **1.49×** |      98% |
| rewriteHtml article.html (327 KiB)            | 10.55 ms |     17.76 ms | **1.68×** |      90% |
| rewriteHtml Wikipedia article (live, 387 KiB) | 21.82 ms |     30.21 ms | **1.38×** |      93% |
| rewriteHtml MDN page (live, 161 KiB)          |  4.76 ms |      6.86 ms | **1.44×** |      88% |
| rewriteCss site.css (76 KiB)                  |  0.38 ms |      0.52 ms | **1.37×** |      97% |
| rewriteCss framework.css (353 KiB)            |  2.01 ms |      2.68 ms | **1.33×** |      95% |
| rewriteUrl ×5000                              |  5.51 ms |      8.05 ms | **1.46×** |     100% |
| unrewriteUrl ×5000                            |  5.61 ms |     10.22 ms | **1.82×** |     100% |

Equivalently, in throughput terms: Sherpa rewrites HTML at 17–67 MiB/s where
Scramjet 1.x manages 13–18 MiB/s on the same inputs — so one worker core
serves roughly 1.4–1.7× the pages (5× on inline-script-heavy ones) for the
same CPU cost.

### End-to-end: full proxied page load in Chromium (median warm load)

| Page                         |           Sherpa |   Scramjet 1.1.0 |           Speedup |
| ---------------------------- | ---------------: | ---------------: | ----------------: |
| landing.html (run 1 / run 2) | 151.7 / 135.2 ms | 180.3 / 170.2 ms | **1.19× / 1.26×** |
| article.html                 | 192.3 / 185.9 ms | 225.4 / 225.3 ms | **1.17× / 1.21×** |
| app.html (script-heavy)      | 159.5 / 146.5 ms | 178.8 / 184.0 ms | **1.12× / 1.26×** |
| gallery.html (media-heavy)   | 191.1 / 185.1 ms | 218.9 / 210.3 ms | **1.15× / 1.14×** |

Cold start (fresh context + SW install + first page): statistical parity —
741 vs 742 ms and 630 vs 642 ms medians across the two runs.

**Follow-up pass (per-request hot path).** A later pass removed the
per-request IndexedDB traffic and the linear public-suffix-list scan in the
service worker's security emulation (see `src/shared/security/`). Measured
back-to-back on one machine (Chromium 141, same harness, same fixture): the
rewriter-pass baseline scored 1.18–1.22× vs Scramjet 1.1.0; with the
hot-path pass it scores **1.35–1.37×** (e.g. landing 131.4 vs 177.3 ms,
article 175.7 vs 236.7 ms, app 145.8 vs 196.9 ms, gallery 170.3 vs
233.2 ms). The fixture is single-origin, which never even reaches the
public-suffix-list path — pages with cross-origin subresources gain more
(the old PSL scan alone cost ~2.4 ms of CPU per registrable-domain lookup,
several times per cross-origin request; it's ~0.003 ms indexed).

### Wire cost

Total runtime download (all.js + sync.js + wasm): Sherpa 704.4 KiB raw /
260.1 KiB gzip, Scramjet 1.1.0 701.2 KiB raw / 257.7 KiB gzip — **parity**
(Sherpa ~1% larger; it carries extra compatibility fixes: real SW scope
tracking, charset-aware decoding, spec-correct srcset/meta-refresh/script
type handling, configurable error page).

## What changed to get here

All in `src/`, all output-equivalent (verified byte-for-byte):

1. `rewriters/html.ts` — attribute-rule lookup indexed by attribute (was a
   nested scan of every rule × selector per attribute); `bytesToBase64`
   builds its binary string in 8k-char chunks instead of one string object
   per byte (this alone is most of the 5× on inline-script-heavy pages —
   every inline script gets base64-archived for `sherpa-attr-*`); srcset
   parsing scans char codes instead of running a regex per character;
   indexed child traversal (was `for..in` over an array); element handling
   gated on `attribs` so text nodes skip it; script MIME essence computed
   once per script.
2. `rewriters/css.ts` — regexes compiled once at module scope; matches
   rebuilt from capture groups instead of rescanning each match with
   `String#replace` (which was quadratic per match and corrupted output when
   a rewritten URL contained `$&`-style patterns); dropped a
   `new String(css).toString()` allocation.
3. `rewriters/url.ts` — special-scheme checks gated on the first character
   (the dominant http/relative case skips the whole `startsWith` chain);
   `location.origin + prefix` cached (was concatenated per URL);
   fragment handling slices `href` instead of paying the URL `hash` setter's
   re-serialization plus a codec call on the empty string.
4. `shared/index.ts` — `flagEnabled` compiles each siteFlags pattern once
   (was `new RegExp` per flag check, several per rewritten resource).
5. `rewriters/wasm.ts` — the rewriter module was being **synchronously
   recompiled (`new WebAssembly.Module`) on every JS rewrite call** because
   `initSync`'s argument was evaluated before its internal
   already-initialized check; now latched to compile exactly once.
6. `worker/fetch.ts` — the WASM bootstrap payload (base64 of the ~0.5 MB
   rewriter, requested by every proxied document) is built once per worker
   lifetime instead of per page load, using the chunked base64; charset
   sniffing decoders hoisted/cached.

Wins that upstream already had are inherited fairly: both sides run the same
htmlparser2/dom-serializer versions (the dominant parse/serialize cost is
common-mode), the same transports, and the same WASM rewriter code.
