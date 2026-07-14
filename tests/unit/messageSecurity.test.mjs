import assert from "node:assert/strict";
import test from "node:test";

import {
	getClientIdentity,
	getVirtualClientUrl,
	isTrustedControllerClient,
	normalizeVirtualScope,
} from "../../src/worker/messageSecurity.ts";

const proxyOrigin = "https://proxy.test";
const prefix = "/sherpa/";
const decode = decodeURIComponent;

test("only same-origin non-proxy clients can notify config changes", () => {
	assert.equal(
		isTrustedControllerClient(
			{ id: "controller", url: "https://proxy.test/app" },
			proxyOrigin,
			prefix
		),
		true
	);
	assert.equal(
		isTrustedControllerClient(
			{
				id: "page",
				url:
					"https://proxy.test/sherpa/" +
					encodeURIComponent("https://victim.test/"),
			},
			proxyOrigin,
			prefix
		),
		false
	);
	assert.equal(
		isTrustedControllerClient(
			{ id: "foreign", url: "https://other.test/app" },
			proxyOrigin,
			prefix
		),
		false
	);
	assert.equal(isTrustedControllerClient(null, proxyOrigin, prefix), false);
});

test("virtual client URLs are derived from Client.url", () => {
	const virtual = "https://example.com/account?tab=security#details";
	const source = {
		id: "page",
		url: `${proxyOrigin}${prefix}${encodeURIComponent(
			virtual.slice(0, virtual.indexOf("#"))
		)}#${encodeURIComponent("details")}`,
	};

	assert.equal(
		getVirtualClientUrl(source, proxyOrigin, prefix, decode)?.href,
		virtual
	);
	assert.equal(
		getVirtualClientUrl(
			{ id: "controller", url: "https://proxy.test/app" },
			proxyOrigin,
			prefix,
			decode
		),
		null
	);
	assert.equal(getClientIdentity({ id: "", url: proxyOrigin }), null);
});

test("service worker scopes remain path-only and same-origin", () => {
	assert.equal(
		normalizeVirtualScope("/app/../assets/", "https://example.com"),
		"/assets/"
	);
	assert.equal(
		normalizeVirtualScope("//evil.test/", "https://example.com"),
		null
	);
	assert.equal(normalizeVirtualScope("relative/", "https://example.com"), null);
});
