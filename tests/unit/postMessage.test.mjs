import assert from "node:assert/strict";
import test from "node:test";

import {
	isLegacyWindowMessageEnvelope,
	isVirtualMessageEnvelope,
	isWindowMessageEnvelope,
	normalizePostMessageTargetOrigin,
	shouldDeliverWindowMessage,
} from "../../src/shared/postMessage.ts";

test("postMessage target origins resolve in the virtual caller realm", () => {
	const source = new URL("https://caller.test/path/page");

	assert.equal(normalizePostMessageTargetOrigin(undefined, source), source.origin);
	assert.equal(normalizePostMessageTargetOrigin("/", source), source.origin);
	assert.equal(normalizePostMessageTargetOrigin("*", source), "*");
	assert.equal(
		normalizePostMessageTargetOrigin("https://target.test/path", source),
		"https://target.test"
	);
	assert.throws(
		() => normalizePostMessageTargetOrigin("../relative", source),
		(error) => error instanceof DOMException && error.name === "SyntaxError"
	);
});

test("invalid target origins fail before the physical postMessage call", () => {
	assert.throws(
		() => normalizePostMessageTargetOrigin("http://[", "https://caller.test/"),
		(error) => error instanceof DOMException && error.name === "SyntaxError"
	);
	assert.throws(
		() => normalizePostMessageTargetOrigin(Symbol(), "https://caller.test/"),
		TypeError
	);
});

test("window envelopes enforce exact virtual target origins", () => {
	const envelope = {
		$sherpa$messagetype: "window",
		$sherpa$origin: "https://caller.test",
		$sherpa$targetOrigin: "https://target.test",
		$sherpa$data: { hello: "world" },
	};

	assert.equal(isWindowMessageEnvelope(envelope), true);
	assert.equal(shouldDeliverWindowMessage(envelope, "https://target.test"), true);
	assert.equal(shouldDeliverWindowMessage(envelope, "https://other.test"), false);
	assert.equal(
		shouldDeliverWindowMessage(
			{ ...envelope, $sherpa$targetOrigin: "*" },
			"https://other.test"
		),
		true
	);
});

test("ordinary application objects are never mistaken for Sherpa envelopes", () => {
	assert.equal(
		isVirtualMessageEnvelope({ $sherpa$data: "application data" }),
		false
	);
	assert.equal(
		isVirtualMessageEnvelope({
			$sherpa$messagetype: "window",
			$sherpa$data: "missing origin",
		}),
		false
	);
	assert.equal(
		isVirtualMessageEnvelope({
			$sherpa$messagetype: "worker",
			$sherpa$data: undefined,
		}),
		true
	);
});


test("legacy window envelopes remain readable during update races", () => {
	const legacy = {
		$sherpa$messagetype: "window",
		$sherpa$origin: "https://caller.test",
		$sherpa$data: "legacy",
	};

	assert.equal(isLegacyWindowMessageEnvelope(legacy), true);
	assert.equal(isWindowMessageEnvelope(legacy), false);
	assert.equal(isVirtualMessageEnvelope(legacy), true);
});
