# Known Issues

Tracked gaps that are understood but deliberately not fixed yet, with the reasoning for deferring them.

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
