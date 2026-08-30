import assert from "node:assert/strict";
import test from "node:test";

import {
	CACHE_KEY_PARAM,
	CLIENT_SYMBOL_KEY,
	DOLLAR_MSG_DATA,
	DOLLAR_MSG_KIND,
	DOLLAR_MSG_ORIGIN,
	DOLLAR_MSG_TYPE,
	FRAME_SYMBOL_KEY,
	INTERNAL_PARAM_PREFIX,
	MSG_PORT,
	MSG_TOKEN,
	MSG_TYPE,
	PAGE_DB_NAME,
	PAGE_GLOBALS,
	PAGE_LOAD_CLIENT,
	REALM_POLLUTANT_KEY,
	SHADOW_ATTRIBUTE_PREFIX,
	STORAGE_DIRECTORY_PREFIX,
	WASM_BUFFER_KEY,
	WASM_PROMISE_KEY,
} from "../../src/shared/pageSurface.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function assertQuiet(name, value) {
	const lower = String(value).toLowerCase();
	assert.equal(
		lower.includes("sherpa"),
		false,
		`${name} leaked "sherpa": ${value}`
	);
	assert.equal(
		lower.includes("bardo"),
		false,
		`${name} leaked "bardo": ${value}`
	);
}

test("page-facing identifiers do not advertise Sherpa or Bardo", () => {
	assertQuiet("PAGE_LOAD_CLIENT", PAGE_LOAD_CLIENT);
	assertQuiet("SHADOW_ATTRIBUTE_PREFIX", SHADOW_ATTRIBUTE_PREFIX);
	assertQuiet("INTERNAL_PARAM_PREFIX", INTERNAL_PARAM_PREFIX);
	assertQuiet("CACHE_KEY_PARAM", CACHE_KEY_PARAM);
	assertQuiet("WASM_PROMISE_KEY", WASM_PROMISE_KEY);
	assertQuiet("WASM_BUFFER_KEY", WASM_BUFFER_KEY);
	assertQuiet("CLIENT_SYMBOL_KEY", CLIENT_SYMBOL_KEY);
	assertQuiet("FRAME_SYMBOL_KEY", FRAME_SYMBOL_KEY);
	assertQuiet("PAGE_DB_NAME", PAGE_DB_NAME);
	assertQuiet("REALM_POLLUTANT_KEY", REALM_POLLUTANT_KEY);
	assertQuiet("STORAGE_DIRECTORY_PREFIX", STORAGE_DIRECTORY_PREFIX);
	assertQuiet("MSG_TYPE", MSG_TYPE);
	assertQuiet("MSG_TOKEN", MSG_TOKEN);
	assertQuiet("MSG_PORT", MSG_PORT);
	assertQuiet("DOLLAR_MSG_TYPE", DOLLAR_MSG_TYPE);
	assertQuiet("DOLLAR_MSG_ORIGIN", DOLLAR_MSG_ORIGIN);
	assertQuiet("DOLLAR_MSG_DATA", DOLLAR_MSG_DATA);
	assertQuiet("DOLLAR_MSG_KIND", DOLLAR_MSG_KIND);
	for (const [key, value] of Object.entries(PAGE_GLOBALS)) {
		assertQuiet(`PAGE_GLOBALS.${key}`, value);
	}
});

test("page-facing identifiers match Scramjet 1.x", () => {
	assert.equal(PAGE_LOAD_CLIENT, "$scramjetLoadClient");
	assert.equal(SHADOW_ATTRIBUTE_PREFIX, "scramjet-attr-");
	assert.equal(INTERNAL_PARAM_PREFIX, "scramjet.");
	assert.equal(PAGE_GLOBALS.wrapfn, "$scramjet$wrap");
	assert.equal(PAGE_GLOBALS.wrappropertybase, "$scramjet__");
	assert.equal(PAGE_DB_NAME, "$scramjet");
	assert.equal(REALM_POLLUTANT_KEY, "scramjet realm pollutant");
	assert.equal(MSG_TYPE, "scramjet$type");
	assert.equal(STORAGE_DIRECTORY_PREFIX, "scramjet-");
});

test("the page-injected entry file does not name Sherpa or Bardo", () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const source = readFileSync(
		join(here, "../../src/client/pageEntry.ts"),
		"utf8"
	);
	assertQuiet("pageEntry.ts", source);
});

test("the built page client bundle does not name Sherpa or Bardo", () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const bundlePath = join(here, "../../dist/sherpa.client.js");
	let source;
	try {
		source = readFileSync(bundlePath, "utf8");
	} catch {
		return;
	}
	assertQuiet("dist/sherpa.client.js", source);
});
