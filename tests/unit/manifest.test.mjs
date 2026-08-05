import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./helpers/srcResolver.mjs", import.meta.url);

const { rewriteManifest } =
	await import("../../src/shared/rewriters/manifest.ts");

const MANIFEST_URL = "https://example.com/app/manifest.webmanifest";

/**
 * Stands in for the engine's URL rewriter: resolves against the manifest's own
 * URL (which is what `rewriteUrl` does with a manifest-based meta) and marks
 * the result, so assertions read as intent rather than as codec output.
 */
const rewrite = (url) => `<${new URL(url, MANIFEST_URL).href}>`;
const mark = (json) =>
	JSON.parse(rewriteManifest(JSON.stringify(json), rewrite));

test("rewrites every URL-valued manifest member", () => {
	const out = mark({
		name: "Example",
		start_url: "/app/?source=pwa",
		scope: "/app/",
		icons: [
			{ src: "icon-192.png", sizes: "192x192" },
			{ src: "https://cdn.example.net/icon-512.png", sizes: "512x512" },
		],
		screenshots: [{ src: "/shots/wide.png" }],
		shortcuts: [{ name: "New", url: "/app/new", icons: [{ src: "new.png" }] }],
		share_target: { action: "/app/share", method: "POST" },
		protocol_handlers: [{ protocol: "web+example", url: "/app/open?u=%s" }],
	});

	assert.equal(out.start_url, "<https://example.com/app/?source=pwa>");
	assert.equal(out.scope, "<https://example.com/app/>");
	// relative members resolve against the manifest's own URL
	assert.equal(out.icons[0].src, "<https://example.com/app/icon-192.png>");
	// and an absolute cross-origin icon keeps its own origin
	assert.equal(out.icons[1].src, "<https://cdn.example.net/icon-512.png>");
	assert.equal(out.screenshots[0].src, "<https://example.com/shots/wide.png>");
	assert.equal(out.shortcuts[0].url, "<https://example.com/app/new>");
	assert.equal(
		out.shortcuts[0].icons[0].src,
		"<https://example.com/app/new.png>"
	);
	assert.equal(out.share_target.action, "<https://example.com/app/share>");
	assert.equal(
		out.protocol_handlers[0].url,
		"<https://example.com/app/open?u=%s>"
	);
});

test("leaves non-URL members exactly as they were", () => {
	const source = {
		name: "Example",
		short_name: "Ex",
		description: "a description with a url-looking word: /app/",
		display: "standalone",
		theme_color: "#ffffff",
		lang: "en",
		icons: [{ src: "/i.png", sizes: "1x1", type: "image/png", purpose: "any" }],
	};
	const out = mark(source);

	assert.equal(out.name, source.name);
	assert.equal(out.description, source.description);
	assert.equal(out.display, source.display);
	assert.equal(out.theme_color, source.theme_color);
	assert.equal(out.icons[0].sizes, "1x1");
	assert.equal(out.icons[0].type, "image/png");
	assert.equal(out.icons[0].purpose, "any");
});

test("a manifest that is not an object is passed through untouched", () => {
	for (const body of ["not json at all", "[1,2,3]", "null", '"a string"']) {
		assert.equal(rewriteManifest(body, rewrite), body);
	}
});

test("malformed members do not throw", () => {
	const out = mark({
		start_url: 5,
		icons: "not-an-array",
		shortcuts: [null, 7, { url: null }],
		share_target: null,
		related_applications: [{ platform: "play" }],
	});

	assert.equal(out.start_url, 5);
	assert.equal(out.icons, "not-an-array");
	assert.equal(out.shortcuts[2].url, null);
	assert.equal(out.related_applications[0].platform, "play");
});
