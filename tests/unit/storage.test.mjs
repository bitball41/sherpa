import assert from "node:assert/strict";
import test from "node:test";

import {
	storageKeys,
	storagePrefix,
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

test("storagePrefix separates the host from user-controlled keys", () => {
	assert.equal(storagePrefix("example.com"), "example.com@");
});

test("storageKeys only returns keys in the exact host namespace", () => {
	const storage = fakeStorage([
		"example.com@theme",
		"example.com.evil@token",
		"sub.example.com@theme",
		"example.com@",
	]);

	assert.deepEqual(storageKeys(storage, "example.com"), [
		"example.com@theme",
		"example.com@",
	]);
});

test("storageKeys ignores null slots and preserves storage order", () => {
	const storage = fakeStorage(["example.com@first", null, "example.com@last"]);

	assert.deepEqual(storageKeys(storage, "example.com"), [
		"example.com@first",
		"example.com@last",
	]);
});

test("unprefixStorageKey returns the page-facing key", () => {
	assert.equal(
		unprefixStorageKey("example.com@settings", "example.com"),
		"settings"
	);
});
