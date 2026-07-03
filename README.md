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
- **Concrete reliability fixes over the 1.x baseline.** Charset-aware HTML decoding (follows the HTML spec's sniffing order instead of assuming UTF‑8); real Service-Worker scope tracking (upstream matched by origin only, so a single registered worker intercepted _every_ path on that origin); cross-realm `location` assignment; a reworked synchronous-XHR watchdog (upstream cut sync requests off at a hardcoded 1s); CORS/credentials and referrer-policy emulation that honors the request's real credentials mode; and non-`http(s)` scheme passthrough so `tel:`, `intent:`, `magnet:`, and friends stop getting mangled behind the proxy prefix.
- **No size regression for the extra features.** What a page downloads (runtime bundle + WASM rewriter) is at parity with the published Scramjet 1.1.0 (within ~1%, measured raw/gzip/brotli in [`bench/`](bench/README.md)) even though Sherpa carries the fixes above. Sherpa's own dist also dropped ~30% (~2.32 MB → ~1.61 MB) early in the fork by removing a dead dependency and shipping the size-optimized WASM rewriter.
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
frame.navigate("https://example.com");
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
| `flags`                         | Feature flags — service workers, sync XHR, sourcemaps, error capture, download interception, and more.                                                    |
| `siteFlags`                     | Per-site flag overrides keyed by a URL regex, so you can flip features on or off for specific origins.                                                    |
| `globals`                       | The names of the wrapper functions Sherpa injects into rewritten pages (e.g. `$sherpa$wrap`). Rename them to avoid collisions or fingerprint your build.  |
| `files`                         | Where the bundle, WASM, and sync runtime are served from.                                                                                                 |

Because Sherpa is a source dependency you own, these are the easy, supported customizations — but you're never limited to them.

## Development

### Dependencies

Building the WASM rewriter from source requires a full toolchain:

- Recent versions of `node.js` and `pnpm`
- `rustup` with the `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` pinned to **exactly** `0.2.100` (the build script hard-checks this): `cargo install wasm-bindgen-cli --version 0.2.100`
- [Binaryen's `wasm-opt`](https://github.com/WebAssembly/binaryen) (`npm install -g binaryen` ships a prebuilt binary)
- [this `wasm-snip` fork](https://github.com/r58Playz/wasm-snip): `cargo install --git https://github.com/r58Playz/wasm-snip`

On Windows, the `cargo install` steps additionally need Microsoft's MSVC linker — install the Visual Studio Build Tools with the C++ (VCTools) workload.

If you only touch the TypeScript (not the Rust rewriter), the prebuilt WASM under `rewriter/wasm/out/` is reused, so `pnpm build` alone is enough.

### Building

```sh
git clone https://github.com/bitball41/sherpa
cd sherpa
pnpm i
RELEASE=1 pnpm rewriter:build   # always use RELEASE=1 — the default skips wasm-opt and ships a much larger, debug binary
pnpm build                      # bundle (rspack)
pnpm build:types                # type declarations (rslib)
```

### Running Sherpa locally

```sh
pnpm dev
```

Sherpa runs at <http://localhost:1337> and rebuilds on file changes (excluding the rewriter).

### Setting up Typedoc

Typedoc generation is inherited from upstream. There are two builds: user-facing (`/typedoc`) and developer-facing (`/typedoc/dev`). Run locally with:

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
