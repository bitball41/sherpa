import assert from "node:assert/strict";
import test from "node:test";

import {
	createVirtualStorageArea,
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

function mutableFakeStorage(initialEntries = []) {
	const values = new Map(initialEntries);

	return {
		get length() {
			return values.size;
		},
		key(index) {
			return Array.from(values.keys())[index] ?? null;
		},
		getItem(key) {
			return values.has(String(key)) ? values.get(String(key)) : null;
		},
		setItem(key, value) {
			values.set(String(key), String(value));
		},
		removeItem(key) {
			values.delete(String(key));
		},
		clear() {
			values.clear();
		},
	};
}

test("virtual Storage reflective operations stay inside the origin namespace", () => {
	const physical = mutableFakeStorage([
		["https://example.com@theme", "dark"],
		["https://other.test@secret", "hidden"],
	]);
	const storage = createVirtualStorageArea(
		physical,
		"https://example.com"
	);

	assert.equal(storage.theme, "dark");
	assert.equal(storage.secret, null);
	assert.equal("theme" in storage, true);
	assert.equal("secret" in storage, false);
	assert.equal(Object.hasOwn(storage, "theme"), true);
	assert.equal(Object.hasOwn(storage, "missing"), false);
	assert.deepEqual(Object.keys(storage), ["theme"]);

	storage.language = "fr";
	assert.equal(
		physical.getItem("https://example.com@language"),
		"fr"
	);
	assert.equal(delete storage.theme, true);
	assert.equal(physical.getItem("https://example.com@theme"), null);
	assert.equal(physical.getItem("https://other.test@secret"), "hidden");
});

test("virtual Storage key() applies unsigned-long index conversion", () => {
	const storage = createVirtualStorageArea(
		mutableFakeStorage([
			["https://example.com@first", "1"],
			["https://example.com@second", "2"],
		]),
		"https://example.com"
	);

	assert.equal(storage.key(1.9), "second");
	assert.equal(storage.key(Number.NaN), "first");
	assert.equal(storage.key(-1), null);
});

test("virtual Storage forwards symbol properties without string coercion", () => {
	const storage = createVirtualStorageArea(
		mutableFakeStorage(),
		"https://example.com"
	);
	const marker = Symbol("marker");

	storage[marker] = "value";
	assert.equal(storage[marker], "value");
	assert.equal(Reflect.deleteProperty(storage, marker), true);
});
