import assert from "node:assert/strict";
import test from "node:test";

import { flagEnabledForConfig } from "../../src/shared/siteFlags.ts";

test("site flag matching ignores inherited data and invalid patterns", () => {
	const siteFlags = Object.create({
		"inherited\\.test": { sourcemaps: false },
	});
	siteFlags["["] = { sourcemaps: false };
	siteFlags["partial\\.test"] = Object.create({ sourcemaps: false });
	siteFlags["badvalue\\.test"] = { sourcemaps: "disabled" };
	siteFlags["valid\\.test"] = { sourcemaps: false };

	const config = {
		flags: { sourcemaps: true },
		siteFlags,
	};

	let warnings = 0;
	const originalWarn = console.warn;
	console.warn = () => warnings++;
	try {
		assert.equal(
			flagEnabledForConfig(
				config,
				"sourcemaps",
				new URL("https://broken.example")
			),
			true
		);
		assert.equal(
			flagEnabledForConfig(
				config,
				"sourcemaps",
				new URL("https://broken.example")
			),
			true
		);
		assert.equal(
			flagEnabledForConfig(
				config,
				"sourcemaps",
				new URL("https://inherited.test")
			),
			true
		);
		assert.equal(
			flagEnabledForConfig(
				config,
				"sourcemaps",
				new URL("https://partial.test")
			),
			true
		);
		assert.equal(
			flagEnabledForConfig(
				config,
				"sourcemaps",
				new URL("https://badvalue.test")
			),
			true
		);
		assert.equal(
			flagEnabledForConfig(config, "sourcemaps", new URL("https://valid.test")),
			false
		);
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(warnings, 1);
});
