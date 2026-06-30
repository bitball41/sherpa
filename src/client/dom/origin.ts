import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, _self: Self) {
	client.Trap("origin", {
		get() {
			// Correct for the normal case (returns the real, unproxied origin).
			// Known gap: real browsers force window.origin to the literal string
			// "null" for opaque-origin contexts (e.g. <iframe sandbox> without
			// allow-same-origin), but Sherpa has no sandbox-attribute tracking
			// anywhere in the client/frame model, so this always returns a
			// concrete origin even in those cases. See KNOWN_ISSUES.md.
			return client.url.origin;
		},
		set() {
			return false;
		},
	});

	client.Trap("Document.prototype.URL", {
		get() {
			return client.url.href;
		},
		set() {
			return false;
		},
	});

	client.Trap("Document.prototype.documentURI", {
		get() {
			return client.url.href;
		},
		set() {
			return false;
		},
	});

	client.Trap("Document.prototype.domain", {
		get() {
			return client.url.hostname;
		},
		set() {
			return false;
		},
	});
}
