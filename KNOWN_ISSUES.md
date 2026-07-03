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

## CSS `url()` regex truncates at an unescaped `)` inside quoted URLs

**File:** `src/shared/rewriters/css.ts` (`urlRegex`)

The lazy `url\((['"]?)(.+?)(['"]?)\)` pattern (inherited from upstream Scramjet's
vk6 regex; the 2026 perf pass only added capture groups, verified byte-equivalent)
stops matching at the first `)`, even inside a quoted URL like `url('/a(b).png')`.
In practice the damage self-heals with the default `encodeURIComponent` codec: the
suffix after the `)` passes through verbatim and re-concatenates into a proxied URL
that round-trips correctly (covered by `bench/verify.mjs`, and flagged by a review
bot on PR #1 with an example that in fact produces correct output). It only truly
corrupts when a **custom codec** (base64, XOR, ...) is configured, because the raw
suffix then isn't valid codec output.

A real fix means replacing the regex with a quote-aware tokenizer (per CSS syntax,
unquoted `url()` cannot contain unescaped parens, so only the quoted branch needs
it). That changes matching behavior relative to upstream for other edge inputs, so
it should ship as its own compat change with fixtures, not ride along in an
output-equivalence-verified perf PR.

**Status:** deferred; behavior identical to upstream and to pre-perf-pass Sherpa.

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
