import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./helpers/srcResolver.mjs", import.meta.url);

const { setConfig } = await import("../../src/shared/state.ts");
const {
	bootScriptUrl,
	configLiteral,
	engineBootPathname,
	engineErrorPathname,
	injectScriptSrcs,
	parseHttpUrl,
	pickBootDocumentUrl,
	renderBootScript,
	wasmSyncLoaderSource,
} = await import("../../src/shared/bootScripts.ts");
const { INTERNAL_PARAMS } = await import("../../src/shared/internalParams.ts");

const config = {
	prefix: "/sherpa/",
	globals: { wrapfn: "$scramjet$wrap" },
	files: {
		wasm: "/sherpa.wasm.wasm",
		all: "/sherpa.all.js",
		sync: "/sherpa.sync.js",
	},
	flags: { sourcemaps: true, responseCache: true },
	siteFlags: {},
	errorPage: { title: "err" },
	codec: {
		encode: "(url) => url",
		decode: "(url) => url",
	},
};

setConfig(config);

test("engine sentinel paths sit under the configured prefix", () => {
	assert.equal(engineBootPathname("/sherpa/"), "/sherpa/$boot");
	assert.equal(engineErrorPathname("/sherpa/"), "/sherpa/$error");
});

test("injected boot scripts no longer embed cookies or the wasm payload", () => {
	const srcs = injectScriptSrcs(new URL("https://example.com/page"));
	assert.equal(srcs.length, 3);
	assert.ok(srcs[0].startsWith("data:application/javascript;base64,"));
	assert.equal(srcs[1], "/sherpa.all.js");
	assert.ok(srcs[2].startsWith("/sherpa/$boot"));
	assert.ok(srcs[2].includes(`${INTERNAL_PARAMS.url}=`));

	const prefetch = Buffer.from(srcs[0].split(",")[1], "base64").toString("utf8");
	assert.ok(prefetch.includes("fetch(\"/sherpa.wasm.wasm\")"));
	assert.ok(!prefetch.includes("self.WASM"));
	assert.ok(!prefetch.includes("COOKIE"));
	assert.ok(prefetch.length < 500, `prefetch script is ${prefetch.length} bytes`);
});

test("the boot script carries a cookie dump and loadAndHook, not the wasm", () => {
	const dump = JSON.stringify({
		"example.com@session": {
			name: "session",
			value: "abc",
			domain: "example.com",
			path: "/",
		},
	});
	const body = renderBootScript(dump);
	assert.equal(body.startsWith("self.COOKIE="), true);
	assert.equal(body.includes("$scramjetLoadClient().loadAndHook("), true);
	assert.equal(body.includes(configLiteral()), true);
	assert.equal(body.includes("self.WASM"), false);
	assert.ok(body.length < 4000, `boot script is ${body.length} bytes`);
	const cookieLiteral = body.slice(
		"self.COOKIE=".length,
		body.indexOf(";$scramjetLoadClient")
	);
	const jar = JSON.parse(JSON.parse(cookieLiteral));
	assert.equal(jar["example.com@session"].value, "abc");
});

test("boot config omits errorPage branding from every document", () => {
	const literal = configLiteral();
	assert.equal(literal.includes("errorPage"), false);
	assert.equal(literal.includes("err"), false);
	assert.ok(literal.includes("\"prefix\":\"/sherpa/\""));
});

test("the boot script url encodes the virtual document, not a proxied one", () => {
	const url = bootScriptUrl(new URL("https://example.com/a?q=1"));
	const parsed = new URL(url, "https://proxy.example");
	assert.equal(parsed.pathname, "/sherpa/$boot");
	assert.equal(
		parsed.searchParams.get(INTERNAL_PARAMS.url),
		"https://example.com/a?q=1"
	);
});

test("classic workers load wasm as bytes, not as a script", () => {
	const src = wasmSyncLoaderSource("/sherpa.wasm.wasm");
	assert.ok(src.includes("XMLHttpRequest"));
	assert.ok(src.includes("/sherpa.wasm.wasm"));
	assert.ok(!src.includes("importScripts(\"/sherpa.wasm.wasm\")"));
});

test("parseHttpUrl accepts only http(s)", () => {
	assert.equal(parseHttpUrl("https://example.com/a")?.href, "https://example.com/a");
	assert.equal(parseHttpUrl("http://example.com/")?.href, "http://example.com/");
	assert.equal(parseHttpUrl("about:blank"), null);
	assert.equal(parseHttpUrl("javascript:alert(1)"), null);
	assert.equal(parseHttpUrl("not a url"), null);
	assert.equal(parseHttpUrl(null), null);
});

test("$boot ignores a cross-origin scramjet.url hint", () => {
	const hinted = new URL("https://victim.example/");
	const attacker = new URL("https://evil.example/");
	assert.equal(
		pickBootDocumentUrl(hinted, attacker, null)?.href,
		"https://evil.example/"
	);
	assert.equal(pickBootDocumentUrl(hinted, null, attacker)?.href, "https://evil.example/");
	assert.equal(pickBootDocumentUrl(hinted, null, null), null);
});

test("$boot honors a same-origin scramjet.url hint", () => {
	const hinted = new URL("https://example.com/app/page");
	const referrer = new URL("https://example.com/");
	assert.equal(
		pickBootDocumentUrl(hinted, referrer, null)?.href,
		"https://example.com/app/page"
	);
	assert.equal(
		pickBootDocumentUrl(null, referrer, null)?.href,
		"https://example.com/"
	);
});
