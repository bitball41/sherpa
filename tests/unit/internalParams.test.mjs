import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./helpers/srcResolver.mjs", import.meta.url);

const {
	INTERNAL_PARAMS,
	isInternalParam,
	takeInternalParams,
} = await import("../../src/shared/internalParams.ts");

test("reads Sherpa's own hints off a proxied request URL", () => {
	const url = new URL(
		`https://proxy.test/sherpa/encoded?${INTERNAL_PARAMS.type}=module&${INTERNAL_PARAMS.from}=swruntime&${INTERNAL_PARAMS.topFrame}=t&${INTERNAL_PARAMS.parentFrame}=p&${INTERNAL_PARAMS.dest}=worker&${INTERNAL_PARAMS.scope}=%2Fapp%2F`
	);

	const hints = takeInternalParams(url);

	assert.equal(hints.scriptType, "module");
	assert.equal(hints.fromServiceWorkerRuntime, true);
	assert.equal(hints.topFrameName, "t");
	assert.equal(hints.parentFrameName, "p");
	assert.deepEqual(hints.siteParams, []);
	// the encoded upstream URL is the path; a leftover query would corrupt it
	assert.equal(url.href, "https://proxy.test/sherpa/encoded");
});

test("validated metadata wins without consuming target-owned query names", () => {
	const url = new URL(
		`https://proxy.test/sherpa/encoded?${INTERNAL_PARAMS.type}=user&keep=1`
	);
	const hints = takeInternalParams(url, {
		[INTERNAL_PARAMS.type]: "module",
		[INTERNAL_PARAMS.from]: "swruntime",
	});

	assert.equal(hints.scriptType, "module");
	assert.equal(hints.fromServiceWorkerRuntime, true);
	assert.deepEqual(hints.siteParams, []);
	assert.equal(
		url.search,
		`?${INTERNAL_PARAMS.type}=user&keep=1`,
		"the encoded target must stay byte-for-byte intact"
	);
});

// A GET form submitted through the proxy lands its fields on the proxied
// action URL. Sherpa used to claim the bare names `type`, `dest`, `from`,
// `scope`, `topFrame` and `parentFrame` for itself, so a site's own field
// under any of those names was consumed by the worker and never reached it.
test("site query parameters survive names Sherpa used to claim", () => {
	const url = new URL(
		"https://proxy.test/sherpa/encoded?type=video&dest=paris&from=2024-01-01&scope=all&topFrame=1&parentFrame=2&q=hello"
	);

	const hints = takeInternalParams(url);

	assert.equal(hints.scriptType, "");
	assert.equal(hints.fromServiceWorkerRuntime, false);
	assert.equal(hints.topFrameName, undefined);
	assert.equal(hints.parentFrameName, undefined);
	assert.deepEqual(hints.siteParams, [
		["type", "video"],
		["dest", "paris"],
		["from", "2024-01-01"],
		["scope", "all"],
		["topFrame", "1"],
		["parentFrame", "2"],
		["q", "hello"],
	]);
	assert.equal(url.href, "https://proxy.test/sherpa/encoded");
});

test("repeated site parameters keep every value, in order", () => {
	const url = new URL("https://proxy.test/sherpa/encoded?tag=a&tag=b&tag=c");

	assert.deepEqual(takeInternalParams(url).siteParams, [
		["tag", "a"],
		["tag", "b"],
		["tag", "c"],
	]);
});

test("the boot document url hint is consumed, not forwarded to the site", () => {
	const url = new URL(
		`https://proxy.test/sherpa/encoded?${INTERNAL_PARAMS.url}=https%3A%2F%2Fexample.com%2F&q=1`
	);
	const hints = takeInternalParams(url);
	assert.deepEqual(hints.siteParams, [["q", "1"]]);
	assert.equal(url.href, "https://proxy.test/sherpa/encoded");
});

test("the WASM leftover type=module is a module hint, not a site field", () => {
	const url = new URL(
		"https://proxy.test/sherpa/encoded?type=module&keep=1"
	);

	const hints = takeInternalParams(url);

	assert.equal(hints.scriptType, "module");
	assert.deepEqual(hints.siteParams, [["keep", "1"]]);
	assert.equal(url.href, "https://proxy.test/sherpa/encoded");
});

test("unknown scramjet.* parameters are stripped, not forwarded", () => {
	const url = new URL(
		"https://proxy.test/sherpa/encoded?scramjet.somethingnew=1&keep=2"
	);

	assert.deepEqual(takeInternalParams(url).siteParams, [["keep", "2"]]);
});

test("mixed Sherpa hints and site parameters are separated", () => {
	const url = new URL(
		`https://proxy.test/sherpa/encoded?q=cats&${INTERNAL_PARAMS.type}=module&page=2`
	);

	const hints = takeInternalParams(url);

	assert.equal(hints.scriptType, "module");
	assert.deepEqual(hints.siteParams, [
		["q", "cats"],
		["page", "2"],
	]);
});

test("every internal parameter name is inside the namespace", () => {
	for (const name of Object.values(INTERNAL_PARAMS)) {
		assert.equal(isInternalParam(name), true, name);
	}
	for (const name of ["type", "dest", "from", "scope", "q", "sherpa", ""]) {
		assert.equal(isInternalParam(name), false, name);
	}
});

test("internal parameter names survive URLSearchParams unescaped", () => {
	const params = new URLSearchParams();
	params.set(INTERNAL_PARAMS.type, "module");

	assert.equal(params.toString(), `${INTERNAL_PARAMS.type}=module`);
});
