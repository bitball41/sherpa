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

test("invalid target origins fail before physical delivery", () => {
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
		$scramjet$messagetype: "window",
		$scramjet$origin: "https://caller.test",
		$scramjet$targetOrigin: "https://target.test",
		$scramjet$data: { hello: "world" },
	};

	assert.equal(isWindowMessageEnvelope(envelope), true);
	assert.equal(shouldDeliverWindowMessage(envelope, "https://target.test"), true);
	assert.equal(shouldDeliverWindowMessage(envelope, "https://other.test"), false);
	assert.equal(
		shouldDeliverWindowMessage(
			{ ...envelope, $scramjet$targetOrigin: "*" },
			"https://other.test"
		),
		true
	);
});

test("ordinary application objects are not mistaken for envelopes", () => {
	assert.equal(isVirtualMessageEnvelope({ $scramjet$data: "application" }), false);
	assert.equal(
		isVirtualMessageEnvelope({
			$scramjet$messagetype: "window",
			$scramjet$data: "missing origin",
		}),
		false
	);
	assert.equal(
		isVirtualMessageEnvelope({
			$scramjet$messagetype: "worker",
			$scramjet$data: undefined,
		}),
		true
	);
});

test("legacy window envelopes remain readable during update races", () => {
	const legacy = {
		$scramjet$messagetype: "window",
		$scramjet$origin: "https://caller.test",
		$scramjet$data: "legacy",
	};

	assert.equal(isLegacyWindowMessageEnvelope(legacy), true);
	assert.equal(isWindowMessageEnvelope(legacy), false);
	assert.equal(isVirtualMessageEnvelope(legacy), true);
});
