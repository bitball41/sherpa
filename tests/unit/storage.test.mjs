import assert from "node:assert/strict";
import test from "node:test";

import {
	storageKeys,
	storagePrefix,
	storageDirectoryName,
	unprefixStorageKey,
} from "../../src/shared/storage.ts";

function fakeStorage(keys) {
	return {
		get length() {
			return keys.length;
		},
		key(index) {
			return keys[index] ?? null;
		},
	};
}

test("storagePrefix separates the full origin from user-controlled keys", () => {
	assert.equal(storagePrefix("https://example.com"), "https://example.com@");
});

test("storageDirectoryName cannot collide on punctuation", () => {
	assert.notEqual(
		storageDirectoryName("https://a.b"),
		storageDirectoryName("https://a-b")
	);
	assert.notEqual(
		storageDirectoryName("http://example.com"),
		storageDirectoryName("https://example.com")
	);
});

test("storageKeys only returns keys in the exact origin namespace", () => {
	const storage = fakeStorage([
		"https://example.com@theme",
		"http://example.com@token",
		"https://sub.example.com@theme",
		"https://example.com@",
	]);

	assert.deepEqual(storageKeys(storage, "https://example.com"), [
		"https://example.com@theme",
		"https://example.com@",
	]);
});

test("storageKeys ignores null slots and preserves storage order", () => {
	const storage = fakeStorage([
		"https://example.com@first",
		null,
		"https://example.com@last",
	]);

	assert.deepEqual(storageKeys(storage, "https://example.com"), [
		"https://example.com@first",
		"https://example.com@last",
	]);
});

test("unprefixStorageKey returns the page-facing key", () => {
	assert.equal(
		unprefixStorageKey("https://example.com@settings", "https://example.com"),
		"settings"
	);
});
