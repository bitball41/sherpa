<h1 align="center">Sherpa</h1>

<div align="center">
  <img src="assets/sherpa.png" width="440" alt="Sherpa logo" />
</div>

<div align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-orange?style=flat" alt="License: AGPL-3.0-only" />
  <img src="https://img.shields.io/badge/status-experimental-orange?style=flat" alt="Status: experimental" />
  <img src="https://img.shields.io/github/issues/bitball41/sherpa?style=flat&color=orange" alt="GitHub issues" />
  <img src="https://img.shields.io/github/stars/bitball41/sherpa?style=flat&color=orange" alt="GitHub stars" />
</div>

---

> **Fork notice:** Sherpa is a fork of [Mercury Workshop's Scramjet](https://github.com/MercuryWorkshop/scramjet) — specifically the `legacy`/1.x line — licensed **AGPL-3.0-only**. It began as a rebrand-only baseline and is being incrementally modified; everything beyond the rename is tracked in this repo's commit history. All credit for the original design and implementation goes to Mercury Workshop.

Sherpa is an **interception-based web proxy** that runs almost entirely in the browser. It rewrites a site's HTML, CSS, and JavaScript on the fly and re-serves it from your own origin through a Service Worker, so pages load as if they were yours — bypassing cross-origin restrictions and browser sandboxing along the way. It's designed to support a wide range of real-world sites, to be embedded as middleware in other projects, and to prioritize security, developer-friendliness, and performance.

Sherpa is the proxy engine behind **Bardo**, a separate web-proxy app. The goal of the fork is an engine that can be owned and modified directly rather than consumed as an upstream black box.

## What makes Sherpa different from Scramjet

Scramjet is what everyone already reaches for, so the fair question is why run Sherpa instead. Sherpa forks Scramjet's `legacy`/1.x engine and keeps the same API — the difference is what the fork optimizes for:

- **Customization is a first-class feature, not a fork-and-patch chore.** The error page is fully themeable straight from config — colors, fonts, logo, copy, or raw CSS — with no engine edits, plus a built-in way to preview it. The proxy prefix, URL codec, feature flags, per-site flag overrides, and the names of the globals Sherpa injects are all configurable too. See [Customization](#customization). And because Sherpa ships as source you own, anything config doesn't cover you can still change directly; stock Scramjet is typically consumed as an unmodifiable npm dependency.
- **Measurably faster.** Sherpa's rewriting pipelines are 1.3–1.8× faster than Scramjet 1.x on the same inputs (up to 5× on inline-script-heavy pages), and the per-request overhead in the service worker's security emulation is gone too (upstream opened several IndexedDB connections and ran ~4 awaited IDB transactions plus a linear ~10k-rule public-suffix-list scan per proxied request). Together that measures ~1.35× faster full proxied page loads in Chromium against the published Scramjet 1.1.0 — same service worker pipeline, same transports, same fixture site, engine as the only variable. Methodology, statistics, and a reproducible harness live in [`bench/`](bench/README.md).
- **Proxied pages run their own JavaScript far faster.** Everything above is service-worker-side. The other half of a proxy's cost is what the page pays _while it runs_: every trapped DOM call and every wrapped global access, on a bill proportional to how much the site does rather than how big it is. Sherpa cut the hot ones by large multiples — resolving the document base no longer walks the whole DOM per rewritten URL, registering a listener no longer scans every listener already on the target (and no longer pins every element that ever had one in memory), walking `element.attributes` no longer re-enters a `Proxy` per index, and a wrapped identifier holding a primitive returns without touching the window at all. Measured in Chromium inside a real proxied page by [`bench/client-hotpath.mjs`](bench/README.md).
- **A proxied document starts arriving immediately.** A service worker's response does not exist until its body does, so on the 1.x design a proxied page's time-to-first-byte was the document's _whole_ download time — and the runtime's boot scripts could not even be requested until after that. Sherpa streams the document instead: as soon as the first kilobyte of the upstream body arrives it writes out the page's own doctype plus the boot scripts, so the runtime downloads and compiles while the rest of the document is still on the wire. Time-to-first-byte is flat in document size now and at parity with an unproxied load — on a 1.2 MiB document over a 10 Mbit/s link, 1208 ms → 52 ms. Rewriting itself is unchanged: the remainder is still parsed as one tree, so `<base href>` resolution and every rewriting rule behave exactly as before.
- **Repeat visits are actually cached.** Responses a service worker synthesizes are never kept in the browser's HTTP cache, and neither Scramjet nor its transport has a cache of its own — so on the 1.x design every navigation re-downloads _and_ re-rewrites every script, stylesheet, font and image a page touches, forever, whatever `Cache-Control` the origin sent. Sherpa stores the **rewritten** response in the Cache API and honors the origin's own caching rules, so a hit skips the transport and the rewriter both, and a stale entry revalidates with `ETag`/`Last-Modified` instead of re-downloading. See [Response caching](#response-caching).
- **A proxied page is only handed its own cookies.** Every virtual origin a proxy like this serves shares one _physical_ origin, so a proxied page can reach into any frame it embeds and read that frame's runtime state directly. On the 1.x design each proxied document was injected with the **entire** cookie jar — every host the session had ever touched, `httpOnly` session cookies included — so embedding a single iframe handed a page every unrelated site's session. Sherpa injects exactly what `document.cookie` may return in that realm: that host's cookies, never `httpOnly`. A response's `Set-Cookie` is likewise only pushed into a page's realm when that page could ever read it, which also stops every cross-site subresource that sets a cookie from waiting on a round trip to the page for a jar it cannot use.
- **What a page reads back is its own URL, not the proxy's.** A proxy is only as good as its reverse direction: every place a site can ask "what is this element pointing at" has to answer with the site's URL. Sherpa closed a run of accessors where the answer was Sherpa's — a link's stringifier (`String(a)`, `a + ""`, `new URL(a)`, all separate from the `href` getter that was already correct), `img.currentSrc` (what a lazy loader reads), `getComputedStyle(el).backgroundImage`, a stylesheet's own `href`, and a rule's `style` inside `document.styleSheets`. `MutationObserver` no longer reports Sherpa's bookkeeping either: rewriting an attribute used to deliver the page a second record for an attribute it has never heard of, and an `oldValue` on the proxy's origin.
- **Concrete reliability fixes over the 1.x baseline.** Charset-aware HTML decoding (follows the HTML spec's sniffing order instead of assuming UTF‑8); real Service-Worker scope tracking (upstream matched by origin only, so a single registered worker intercepted _every_ path on that origin); cross-realm `location` assignment; a reworked synchronous-XHR watchdog (upstream cut sync requests off at a hardcoded 1s); CORS/credentials and referrer-policy emulation that honors the request's real credentials mode; and non-`http(s)` scheme passthrough so `tel:`, `intent:`, `magnet:`, and friends stop getting mangled behind the proxy prefix.
- **More of the platform is actually rewritten.** Six paths a page can take to a URL reached the network unrewritten on the 1.x baseline, which means they resolved against the _proxy's_ origin instead of the site's and failed: everything a web component writes through `ShadowRoot`'s own `innerHTML`/`setHTMLUnsafe` (a separate accessor from `Element`'s, and it was never trapped); CSS written into a `<style>` by any node-insertion API, which is how Emotion, JSS and styled-components inject rules outside their fast path; SVG 1.1's `xlink:href`, which is what every icon sprite in the wild uses; `<body background>`; web app manifests, so an installable site's icons and `start_url` stay inside the proxy; and Sherpa's own query hints, which used to show up in a worker's `self.location.search`. The reverse case is handled too: a `<style>` whose `type` is not a CSS type is inert markup per HTML — Tailwind's browser build keeps its input in `<style type="text/tailwindcss">` — so its body is left exactly as authored instead of being rewritten out from under the library that owns it.
- **The extra features cost single-digit percent on the wire.** What a page downloads (runtime bundle + WASM rewriter) is ~747 KiB raw / ~274 KiB gzip / ~214 KiB brotli, against ~701 / ~258 / ~199 for the published Scramjet 1.1.0 — about **5–7% larger** for everything above, essentially all of it in the runtime bundle rather than the rewriter (the WASM is within ~1%). Measured raw/gzip/brotli by [`bench/size.mjs`](bench/README.md); re-run it rather than trusting this line, since it moves with every pass. Sherpa's own dist also dropped ~30% (~2.32 MB → ~1.61 MB) early in the fork by removing a dead dependency and shipping the size-optimized WASM rewriter.
- **Focused scope.** Sherpa's stated goals are site compatibility and performance/size. Stealth / anti-detection is explicitly a non-goal.

Everything past the rename is tracked in this repo's commit history; [`AGENTS.md`](AGENTS.md) has the full rationale.

## Supported sites

Sherpa has CAPTCHA support. Some of the popular sites it handles include:

- [Google](https://google.com)
- [Twitter / X](https://twitter.com)
- [Instagram](https://instagram.com)
- [YouTube](https://youtube.com)
- [Spotify](https://spotify.com)
- [Discord](https://discord.com)
- [Reddit](https://reddit.com)
- [GeForce NOW](https://play.geforcenow.com/)

Beyond individual sites, these are the site-building technologies Sherpa carries through the proxy, and where each one is checked:

| Technology                                                                              | What works                                                                                                                                                                                                                                                                                                | Checked by                                                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Web components / shadow DOM** (Lit, Polymer, Stencil, Ionic)                          | Markup written through `ShadowRoot`'s own `innerHTML` / `setHTMLUnsafe` / `getHTML`                                                                                                                                                                                                                       | `test:behavior`                                                                                     |
| **CSS-in-JS** (Emotion, styled-components, JSS, hand-rolled)                            | Every way of writing a `<style>`'s text — `textContent`, `innerHTML`, `appendChild`, `append`, `prepend`, `insertBefore`, `replaceChild`, `replaceChildren`, `insertAdjacentText`, the text node's `data`/`nodeValue` — plus `insertRule` (including inside `@media`), `addRule`, `replace`/`replaceSync` | `test:behavior`                                                                                     |
| **Tailwind CSS**                                                                        | Compiled output like any stylesheet; the runtime `@tailwindcss/browser` build compiles too, because a `<style>` with a non-CSS `type` is left exactly as authored                                                                                                                                         | `test:behavior` covers the mechanism; the published Tailwind 4 bundle was driven end-to-end by hand |
| **Constructable stylesheets / `adoptedStyleSheets`**                                    | `CSSStyleSheet.replace` / `replaceSync`                                                                                                                                                                                                                                                                   | —                                                                                                   |
| **ES modules, import maps, dynamic `import()`, `import.meta.url`**                      | Rewritten, with module-ness threaded through to the rewriter                                                                                                                                                                                                                                              | `test:unit` (import maps)                                                                           |
| **Web workers, shared workers, worklets, emulated service workers**                     | Rewritten, with the runtime injected into each                                                                                                                                                                                                                                                            | `test:behavior` (workers)                                                                           |
| **SVG** — sprites (`<use href>` _and_ `xlink:href`), gradients, filters, `<svg><style>` | Rewritten                                                                                                                                                                                                                                                                                                 | `test:behavior`                                                                                     |
| **Progressive web apps**                                                                | Manifest `start_url`, `scope`, icons, screenshots, shortcuts, share/protocol/file handlers                                                                                                                                                                                                                | `test:unit`                                                                                         |
| **Non-UTF-8 documents**                                                                 | Charset sniffed in the HTML spec's order, re-served as UTF-8                                                                                                                                                                                                                                              | `test:behavior`                                                                                     |

> **Tip:** Don't host on a datacenter IP if you want CAPTCHAs (and YouTube) to work reliably. Heavy traffic from a single IP will cause some sites to fail. Consider rotating IPs or routing through WireGuard with a project like [wireproxy](https://github.com/whyvl/wireproxy).

Known compatibility gaps that are understood but deliberately deferred are tracked in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## How it works

Sherpa splits into three cooperating contexts, all built from `src/`:

| Context            | Entry                         | Role                                                                                                                                                            |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Controller**     | `SherpaController` (window)   | Configures the proxy, manages `IndexedDB` state and the Service Worker, and creates proxied frames.                                                             |
| **Client**         | `SherpaClient` (proxied page) | The runtime injected into every proxied page. Traps and rewrites DOM, `location`, `postMessage`, workers, storage, and more so the page can't escape the proxy. |
| **Service Worker** | `SherpaServiceWorker`         | Intercepts every request from proxied pages and rewrites responses (HTML/CSS/JS) before they reach the page.                                                    |

The heavy lifting — the JavaScript rewriter — is a Rust program compiled to WebAssembly, living in [`rewriter/`](rewriter/). It parses each script and injects the wrapper calls that keep proxied globals (`location`, `top`, `parent`, `eval`, …) pointed back at Sherpa.

## Using Sherpa

Sherpa currently ships as a source project. It is embedded as a **local dependency** (a `file:` link, e.g. from Bardo) rather than being published to npm yet; publishing to `github.com/bitball41/sherpa` and npm is planned. Either build it from source (below) or point your app at a local checkout.

Once the bundle (`dist/sherpa.all.js`) is loaded on the page, the API is exposed through factory globals:

```js
// On the page hosting the proxy
const { SherpaController } = $sherpaLoadController();

const sherpa = new SherpaController({
	prefix: "/sherpa/",
});

await sherpa.init();

const frame = sherpa.createFrame();
document.body.appendChild(frame.frame);
frame.go("https://example.com");
```

In your Service Worker:

```js
// sw-sherpa.js
importScripts("/sherpa.all.js");

const { SherpaServiceWorker } = $sherpaLoadWorker();
const sherpa = new SherpaServiceWorker();

self.addEventListener("fetch", (ev) => {
	ev.respondWith(
		(async () => {
			await sherpa.loadConfig();
			if (sherpa.route(ev)) {
				return sherpa.fetch(ev);
			}
			return fetch(ev.request);
		})()
	);
});
```

`SherpaController.encodeUrl(url)` / `decodeUrl(url)` convert between real URLs and their proxied form if you need to build links yourself. See the API reference (Typedoc, below) or the runnable demo in [`static/`](static/) for a complete wiring.

For the smallest possible end-to-end integration — a plain page, a ~20-line service worker, and a small server — see [`examples/minimal/`](examples/minimal/). It also doubles as a customization demo (custom error-page theme + custom URL codec, both from config).

## Customization

Sherpa is meant to be reskinned and reconfigured per deployment. Almost all of it lives on the `SherpaController` config, so you can change it without touching the engine source.

### The error page

When a proxied navigation fails, Sherpa serves a built-in error page. It's fully themeable through the `errorPage` config — set any subset of fields and the rest fall back to Sherpa's defaults:

```js
const sherpa = new SherpaController({
	prefix: "/sherpa/",
	errorPage: {
		background: "#ffffff", // page background          (default: white)
		text: "#222444", // primary text             (default: #222444, deep navy)
		muted: "#a0a1dc", // secondary text           (default: #a0a1dc, lavender)
		accent: "#a1c5f3", // buttons & links          (default: #a1c5f3, sky blue)
		accentText: "#222444", // text drawn on the accent color
		surface: "#eef0fb", // card / textarea background
		title: "Uh oh!", // the big heading
		logo: "/brand/logo.svg", // optional logo above the title (URL or data URI)
		repoUrl: "https://github.com/bitball41/sherpa", // troubleshooting link
		fontSans: "system-ui, sans-serif", // body font stack
		fontMono: "ui-monospace, monospace", // error-trace font stack
		css: "", // raw CSS appended last, for anything the fields don't reach
	},
});
```

Those four colors — white, `#222444`, `#a0a1dc`, `#a1c5f3` — are the defaults: a clean light theme. Override only the fields you care about. Anything the named fields don't cover goes in `errorPage.css`, which is appended _after_ Sherpa's own styles so it always wins. You can also re-theme at runtime:

```js
sherpa.modifyConfig({
	errorPage: { accent: "#e11d48", title: "This page didn't load" },
});
```

**Previewing it** — you don't have to break a real site to see your theme. Point any frame at `SherpaController.errorPreviewUrl` (which is just `` `${prefix}$error` ``) and Sherpa renders the error page with a sample trace filled in:

```js
const frame = sherpa.createFrame();
document.body.appendChild(frame.frame);
frame.frame.src = sherpa.errorPreviewUrl; // shows your themed error page
```

The runnable demo in [`static/`](static/) wires this to an **error page** button in its toolbar.

### Other knobs

All on the `SherpaController` config:

| Field                           | What it does                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`                        | The path every proxied URL lives under (default `/sherpa/`). Rebrand or obscure your proxy routes by changing it.                                         |
| `codec.encode` / `codec.decode` | How real URLs get encoded into proxied ones. Defaults to `encodeURIComponent`; drop in Base64, XOR, or any reversible transform to change how links look. |
| `flags`                         | Feature flags — service workers, sync XHR, sourcemaps, response caching, error capture, download interception, and more.                                  |
| `siteFlags`                     | Per-site flag overrides keyed by a URL regex, so you can flip features on or off for specific origins.                                                    |
| `globals`                       | The names of the wrapper functions Sherpa injects into rewritten pages (e.g. `$sherpa$wrap`). Rename them to avoid collisions or fingerprint your build.  |
| `files`                         | Where the bundle, WASM, and sync runtime are served from.                                                                                                 |

Because Sherpa is a source dependency you own, these are the easy, supported customizations — but you're never limited to them.

## Response caching

A service worker's synthesized responses are never stored in the browser's HTTP cache. Sherpa therefore keeps its own, in the Cache API, holding the **rewritten** response — so a hit costs neither a trip over the transport nor a pass through the rewriter.

It is on by default and follows the origin's own rules rather than inventing its own:

- Freshness comes from `Cache-Control: max-age`, then `Expires`, then RFC 9111 heuristic freshness (a tenth of the time since `Last-Modified`, capped at a day); an upstream `Age` is subtracted. It is a _private_ cache — one browser profile, not shared between users — so `private` is storable and `s-maxage` is not consulted.
- `no-store` is never stored. `no-cache` is stored but always revalidated. A stale entry with an `ETag`/`Last-Modified` is revalidated with a conditional request, and a `304` replays the stored rewrite.
- Not stored: anything that isn't a `200` to a `GET`, responses that set cookies, responses that `Vary` on something the engine cannot reproduce (`Cookie`, `User-Agent`, `*`), requests carrying `Authorization`, `Range` or the page's own conditional headers, and bodies over 5 MiB.
- **Documents are never cached.** A proxied document embeds a snapshot of the cookie jar for the client's synchronous `document.cookie`, so replaying one could boot a page with a stale session. Subresources carry no such state — and they are where the repeat-visit cost is.
- The cache key includes the request's destination and module-ness (the same URL rewrites differently as a script, a module and a stylesheet) plus the `Vary` headers it can reproduce. The bucket name embeds a fingerprint of the prefix, codec, globals, files and flags, so `modifyConfig` starts from a clean bucket instead of serving output rewritten under the old configuration.

Turn it off per deployment or per site:

```js
new SherpaController({
	flags: { responseCache: false },
	siteFlags: { "^https://example\\.com": { responseCache: false } },
});
```

`bench/cache-e2e.mjs` drives all of the above through a real Chromium, service worker and transport, over a shaped 60 ms / 10 Mbit link: with the cache on, a page of the site the visitor has not seen before fetches its document and revalidates one `no-cache` script, and everything else — the vendor bundle, the stylesheet, the image — is served without touching the origin. Turning `responseCache` off brings every one of those requests back. Repeat proxied navigation on that fixture, each sample the first navigation of a fresh page: **1.5–1.7×** faster (two runs: 394.5 → 258.6 ms and 399.3 → 231.5 ms).

## Development

### Dependencies

Building the WASM rewriter from source requires a full toolchain:

- Recent versions of `node.js` and `pnpm`
- `rustup` with the `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` pinned to **exactly** `0.2.100` (the build script hard-checks this): `cargo install wasm-bindgen-cli --version 0.2.100`
- [Binaryen's `wasm-opt`](https://github.com/WebAssembly/binaryen) (`npm install -g binaryen` ships a prebuilt binary)
- [this `wasm-snip` fork](https://github.com/r58Playz/wasm-snip): `cargo install --git https://github.com/r58Playz/wasm-snip`

On Windows, the `cargo install` steps additionally need Microsoft's MSVC linker — install the Visual Studio Build Tools with the C++ (VCTools) workload.

`rewriter/wasm/out/` is generated and gitignored. A fresh checkout must run the rewriter build once; after that, TypeScript-only changes can reuse the local WASM output and run `pnpm build` directly.

### Building

```sh
git clone https://github.com/bitball41/sherpa
cd sherpa
pnpm i
RELEASE=1 pnpm rewriter:build   # always use RELEASE=1 — the default skips wasm-opt and ships a much larger, debug binary
pnpm build                      # bundle (rspack)
pnpm build:types                # type declarations (rslib)
```

### Testing

```sh
pnpm test:unit        # leaf modules, in node
pnpm test:behavior    # the real pipeline, in Chromium
pnpm test             # unit + package validation + playwright integration
```

`tests/behavior/` boots the shipped `dist/` — service worker, WASM rewriter,
bare-mux over wisp — against a local fixture origin and runs its assertions
_inside_ the proxied document, which is the only place the client-side traps
can be observed as a site sees them. It needs a Chromium; set
`SHERPA_CHROMIUM=/path/to/chrome` if `npx playwright install` isn't an option.
It runs in CI ahead of the live-site Playwright suite, which drives real
Google/YouTube and is flaky by design from datacenter IPs — so an actual engine
regression is reported on its own rather than lost in that noise.

> **The `dist/` it loads is a build artifact.** Run `pnpm build` first, or the
> suite tests whatever was last committed. The bundle embeds the WASM
> rewriter, and the wasm-bindgen glue in `rewriter/wasm/out/` has to come from
> the same rewriter build as `dist/sherpa.wasm.wasm` — mixing a glue from one
> build with a binary from another silently disables JS rewriting rather than
> failing loudly.

### Running Sherpa locally

```sh
pnpm dev
```

Sherpa runs at <http://localhost:1337> and rebuilds on file changes (excluding the rewriter).

### Setting up Typedoc

Typedoc generation is inherited from upstream. There are two builds: user-facing (`/typedoc`) and developer-facing (`/typedoc-dev`). Run locally with:

```sh
pnpm run docs
pnpm docs:dev
pnpm docs:serve
```

### Serve everything (demo + Typedoc)

To reproduce what CI publishes to GitHub Pages — the demo and Typedoc together — run:

```sh
chmod +x scripts/serve-static.sh
./scripts/serve-static.sh
```

This simulates the CI pipeline as a shell script.

## Project layout

```
src/
  controller/   SherpaController — window-side setup, IDB, frames
  client/       SherpaClient — the runtime injected into proxied pages
  worker/       SherpaServiceWorker — request/response interception
  shared/       rewriters (html/css/js/url) and config shared across contexts
rewriter/       Rust → WASM JavaScript rewriter (the compat-critical core)
bench/          reproducible Sherpa-vs-Scramjet performance benchmarks
static/         runnable demo served by `pnpm dev`
dist/           build output (bundle + wasm + types)
docs/           extra Typedoc pages
```

`AGENTS.md` is the durable, tool-agnostic source of truth for the fork's direction, decisions, and open work — start there (plus `git log`) if you're picking the project up.

## Resources

- [TN Docs for Scramjet](https://docs.titaniumnetwork.org/proxies/scramjet) — documents the upstream API Sherpa currently mirrors; useful until Sherpa diverges and gets its own docs.
- [Upstream Scramjet](https://github.com/MercuryWorkshop/scramjet) — the original project this fork is based on.

## License

Sherpa is licensed **AGPL-3.0-only**, inherited verbatim from upstream Scramjet — see [`LICENSE`](LICENSE). The AGPL's §13 network clause means that if you deploy a modified Sherpa in a network-served app, you must offer users that app's complete corresponding Sherpa source. Keeping this repository public and linking to it from the host app satisfies that; it does **not** require open-sourcing the rest of the host app.
