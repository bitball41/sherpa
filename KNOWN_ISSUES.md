# Known Issues

Tracked gaps that are understood but deliberately not fixed yet, with the reasoning for deferring them. Several sit on the same architectural fault lines as upstream Scramjet; where that's the case it's called out. If you're looking for what _has_ been fixed, see `AGENTS.md` and `git log`.

## `window.origin` doesn't go opaque ("null") for sandboxed iframes

**File:** `src/client/dom/origin.ts`

The `origin` trap returns `client.url.origin` (the real, unproxied origin), which is
correct for the normal case. The known gap is `<iframe sandbox>` without
`allow-same-origin`: real browsers force `window.origin` (and related origin checks)
to the literal string `"null"` in that case, regardless of the URL being displayed.
Sherpa currently has no sandbox-attribute tracking anywhere in the client/frame
model, so it always returns a concrete origin even inside a sandboxed,
should-be-opaque context.

This is also an open, unfixed issue in upstream Scramjet itself — both the `legacy`
and the actively-developed `main`/2.x branches carry the same `"this isn't
right!!"` comment with no resolution. A correct fix means adding sandbox-attribute
propagation through frame creation, not a one-line patch to this file.

**Status:** deferred. Revisit if a site is found that actually depends on
sandboxed-iframe opaque-origin behavior.

## `about:blank` / `about:srcdoc` frames inherit a base URL but not an origin

**File:** `src/client/client.ts` (`fallbackBase`), `src/client/dom/origin.ts`

A frame with no URL of its own inherits _both_ its creator's base URL and its
creator's origin, per HTML. Sherpa now inherits the base — which is what makes the
URLs such a frame creates resolve to the site rather than to the proxy's origin —
but the document URL is deliberately left as `about:blank`, because that is what
`location.href` genuinely reports there.

Everything derived from `client.url` therefore still sees the opaque document
URL: `window.origin` answers `"null"`, and the per-origin namespaces for
`localStorage`, `CacheStorage` and IndexedDB key on `"null@"` rather than on the
creator's origin. So an `about:blank` frame gets its own storage namespace instead
of sharing the embedding page's.

Separating the document URL from the origin/base pair means threading a second
URL through the client rather than the one `client.url` everything reads, and it
runs straight into the sandbox-attribute gap above (a _sandboxed_ `about:blank`
frame is supposed to have an opaque origin, which is what Sherpa reports today).

**Status:** deferred. The URL-resolution half — the one that made requests escape
to the proxy's origin — is fixed; the storage half needs the frame model that the
sandbox item above needs anyway.

## Documents served as `application/xhtml+xml` are not rewritten at all

**File:** `src/worker/response.ts` (`isHtmlContentType`), `src/worker/fetch.ts`

`rewriteBody` only treats `text/html` as a document. An XHTML document therefore
passes through untouched, so every relative URL in it resolves against the
**proxy's** origin and 404s there — the page is comprehensively broken rather than
subtly wrong.

Rewriting it is not a one-line content-type addition. XHTML is parsed as XML, so
the output has to stay well-formed: the boot scripts cannot be flushed ahead of the
root element the way the streaming path does for HTML (elements before the root are
an XML parse error, so such documents would have to take the buffered path),
`dom-serializer` has to run in XML mode to keep self-closing tags and namespace
prefixes intact, and an inline script's text is `#PCDATA` there — it needs a CDATA
section or escaping, which the current rewriter does not produce. Getting any of
that wrong replaces a broken page with a yellow screen of death.

**Status:** deferred. XHTML is rare enough on the modern web that a botched
attempt is worse than the current state; revisit with a real failing site and the
buffered-path plumbing above.

## `javascript:` URLs are not un-rewritten when read back

**File:** `src/shared/rewriters/url.ts` (`unrewriteUrl`, the `//TODO` branch)

`rewriteUrl` correctly rewrites a `javascript:` URL by running its body through
`rewriteJs`. The reverse — handing the page back the _original_ source when it reads,
say, `anchor.href` — is a no-op: the rewritten JS is returned as-is. This is a
fidelity gap, not usually a functional break (the code still runs correctly; a page
that reads its own `javascript:` href back just sees the instrumented form).

A clean fix isn't really possible: `rewriteJs` injects wrapper calls and is not a
losslessly reversible transform, so there's no general way to reconstruct the
pre-rewrite text. For attribute reads specifically, the original value is already
preserved separately via the `sherpa-attr-*` shadow attribute that `setAttribute`
records, so `getAttribute("href")` returns the true original — it's only the
property getter path that returns the rewritten form. Upstream leaves this unresolved
as well.

**Status:** deferred. Would need a side-channel that stores the original
`javascript:` source keyed to each rewritten value.

## `postMessage` origin can fall back to guessing across realms

**File:** `src/client/shared/postmessage.ts`

To report a correct `event.origin` to the receiver, the `window.postMessage` trap
needs an object that came from the _caller's_ realm (so it can steal `Function` and
recover the caller's real origin). It tries, in order: the message payload, the
transfer list, then a `$setrealm`-injected object. If all three arguments are plain
strings (copied, not cloned across the realm boundary) it gives up and uses an empty
object, which yields a best-effort origin rather than a guaranteed-correct one.

This is a fundamental limitation of doing cross-realm origin reconstruction from
userland; changing the fallback is high-risk and could regress the common cases that
currently work.

**Status:** deferred. Accept the rare wrong-origin fallback rather than destabilize
the working path.

## Inline `style` is proxied property-by-property ("dumb hack")

**File:** `src/client/dom/css.ts` (the `HTMLElement.prototype.style` trap)

Because `CSSStyleDeclaration`'s prototype chain can't be trapped cleanly, the `style`
getter returns a `Proxy` that intercepts _every_ property access individually to
run values through `rewriteCss`/`unrewriteCss`. It's self-described as an
"unfortunate and dumb hack" but it is correct and it works.

**Status:** deferred (works as-is). A structurally nicer implementation would be a
rewrite with real risk of breaking edge cases for no user-visible gain.

## `cleanrestfn` (`$sherpa$clean`) is a no-op

**File:** `src/client/shared/wrap.ts` (the `config.globals.cleanrestfn` definition)

The Rust rewriter emits `$sherpa$clean(...)` calls around rest/spread patterns and
destructuring that could capture Sherpa's proxied globals, but the runtime
implementation is an empty function. This matches upstream, where it is also
unimplemented.

Implementing it means precisely reasoning about the realm-pollution model; a wrong
implementation would mutate or strip properties from legitimate user rest objects on
**every** rewritten site, which is a much worse failure mode than the current
theoretical leak.

**Status:** deferred. Do not implement without a concrete failing site and a test.

## `@import` in a non-CSS `<style>` still resolves against the proxy origin

**File:** `src/shared/rewriters/css.ts` (`isCssStyleType`), `src/client/dom/css.ts`

Per HTML, a `<style>` element is only a stylesheet when its `type` is absent,
empty, or `text/css`. Anything else — `<style type="text/tailwindcss">`, which is
how Tailwind's browser build carries its input — is inert markup a library reads
for itself, and Sherpa deliberately leaves those bodies exactly as authored:
rewriting them corrupts the library's own source (it turned Tailwind's
`@import "tailwindcss"` into a proxied absolute URL Tailwind could not resolve,
which broke the whole compile).

Chromium, however, still _fetches_ the target of an `@import` inside such an
element, even though it then discards the sheet. Confirmed against a plain
origin with no proxy in the picture. Because the body is unrewritten, that
request resolves against the proxy's origin and gets a 500 rather than reaching
the site.

Nothing depends on it: the sheet is never applied either way, so the only cost
is one failed request per inert `@import`. The alternative — rewriting the body
so that request resolves correctly — breaks the library the markup belongs to,
which is a much worse trade. There is no third option available from userland:
unlike an attribute, text content has no shadow copy the page could be handed
back instead.

**Status:** accepted. Revisit if a browser ever applies these sheets, or if a
site is found where the stray request matters.

## npm publish can never succeed under the current package name

**File:** `.github/workflows/main.yml` (`publish` job), `package.json` (`name`)

The rebrand renamed the package to plain `sherpa`, but that unscoped name is
already owned by an unrelated package on the npm registry (published years ago,
currently at 0.1.8). Two consequences:

- The `version-check` job compared against `@mercuryworkshop/sherpa` — a
  package that has never existed (a rebrand straggler mixing upstream's scope
  with the new name) — so `version_changed` was always `true`. Fixed: it now
  reads the name from `package.json`.
- The `publish` job therefore attempted `npm publish` on **every** main push
  and failed every time (the name belongs to someone else), keeping main's CI
  permanently red. It is now gated behind the repository variable
  `ENABLE_NPM_PUBLISH=true` so it can't fire accidentally.

Actually publishing requires an owner decision first: pick a publishable
identity (e.g. a scoped name like `@bitball41/sherpa`, or a different unscoped
name), update `package.json`, set an `NODE_AUTH_TOKEN`/npm trusted publisher,
and flip the repo variable. Until then Bardo consumes Sherpa as a local
`file:` dependency, so nothing depends on the registry.

**Status:** blocked on an owner decision (name/scope + credentials).

## CI integration tests depend on live Google/YouTube from datacenter IPs

**File:** `.github/workflows/main.yml` (`tests` job), `tests/integration/site/`

The Playwright suite drives `google.com` and `youtube.com` through the proxy
from GitHub-hosted runners. The README itself warns those sites throttle or
block datacenter IPs, so the job is flaky by design and once hung for six
hours on the browser-install step (every job now carries `timeout-minutes`,
so the worst case is bounded). A reliable gate needs either local fixtures
(like `bench/e2e`'s deterministic origin) or a self-hosted runner with a
residential egress.

**Status:** timeouts added; making the suite hermetic is future work.
