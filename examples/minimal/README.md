# Sherpa — minimal example

The smallest end-to-end Sherpa integration: a plain HTML page, a ~20-line
service worker, and a small Node server. No framework, no build step for the
example itself. It also doubles as a customization demo — the error page and the
URL codec are both reskinned **from config, without forking Sherpa**.

## Run it

From the repo root:

```sh
pnpm install
# build the engine once (skip rewriter:build if dist/ is already built):
RELEASE=1 pnpm rewriter:build
pnpm build

node examples/minimal/server.mjs
```

Then open <http://localhost:8989>. Type a URL and press **Go**, or click
**Error page** to preview the themed error page.

## What's here

| File                | Role                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `server.mjs`        | Serves the page, the built engine (`dist/`), bare-mux + the epoxy transport, and a Wisp server. Sets the COOP/COEP headers Sherpa needs. |
| `public/index.html` | Loads the bundle, sets the transport, creates the `SherpaController`, and drives an `<iframe>`.                                          |
| `public/sw.js`      | The service worker — loads `$sherpaLoadWorker()` and routes fetches through Sherpa.                                                      |

## The parts every frontend needs

You wire up these five things (all visible in this example):

1. **Serve the build** (`dist/`) somewhere the page and worker can load it — here
   under `/scram/`. In a Node app you can get the folder from
   `require("sherpa/path").sherpaPath` instead of hard-coding it.
2. **A service worker** that loads the worker half and routes fetches (`sw.js`).
3. **bare-mux + a transport** (epoxy here; libcurl also works), served and
   selected on the page.
4. **A Wisp (or Bare) backend** for outbound traffic — the browser can't open raw
   cross-origin sockets, so it tunnels through Wisp. `server.mjs` runs one.
5. **COOP/COEP cross-origin-isolation headers** on your server.

## Customization, no fork required

Both of these are set purely from the `SherpaController` config in
`public/index.html`:

- **Error page** — `errorPage: { background, accent, title, … }`. Click the
  **Error page** button to see the dark theme this example applies.
- **How proxied links look** — `codec: { encode, decode }`. This example uses
  URL-safe base64, so proxied links read like `/sherpa/aHR0cHM6...` instead of
  the default percent-encoding. The current URL's proxied form is shown live
  under the address bar.

See the repo's [`README.md`](../../README.md#customization) for the full list of
config knobs (prefix, flags, per-site flag overrides, injected global names, …).
