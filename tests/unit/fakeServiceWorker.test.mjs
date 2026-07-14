import assert from "node:assert/strict";
import test from "node:test";

import {
	FakeServiceWorker,
	removeFakeServiceWorker,
	replaceFakeServiceWorker,
} from "../../src/worker/fakesw.ts";

function createWorker(
	origin = "https://example.com",
	scope = "/app/",
	responseTimeoutMs
) {
	const channel = new MessageChannel();
	const worker = new FakeServiceWorker(
		channel.port1,
		origin,
		scope,
		responseTimeoutMs
	);

	return { channel, worker };
}

test("re-registering an origin and scope disposes the old worker", async () => {
	const first = createWorker();
	const second = createWorker();
	const workers = [first.worker];
	const pendingFetch = first.worker.fetch(
		new Request("https://example.com/app/data")
	);

	replaceFakeServiceWorker(workers, second.worker);

	assert.equal(first.worker.disposed, true);
	assert.equal(await pendingFetch, false);
	assert.deepEqual(workers, [second.worker]);

	second.worker.dispose();
	first.channel.port2.close();
	second.channel.port2.close();
});

test("registrations for distinct scopes remain active", () => {
	const first = createWorker("https://example.com", "/app/");
	const second = createWorker("https://example.com", "/admin/");
	const workers = [first.worker];

	replaceFakeServiceWorker(workers, second.worker);

	assert.equal(first.worker.disposed, false);
	assert.deepEqual(workers, [first.worker, second.worker]);

	first.worker.dispose();
	second.worker.dispose();
	first.channel.port2.close();
	second.channel.port2.close();
});

test("unregistering disposes only the exact origin and scope", () => {
	const app = createWorker("https://example.com", "/app/");
	const admin = createWorker("https://example.com", "/admin/");
	const foreign = createWorker("https://other.test", "/app/");
	const workers = [app.worker, admin.worker, foreign.worker];

	assert.equal(
		removeFakeServiceWorker(workers, "https://example.com", "/app/"),
		true
	);
	assert.equal(app.worker.disposed, true);
	assert.deepEqual(workers, [admin.worker, foreign.worker]);
	assert.equal(
		removeFakeServiceWorker(workers, "https://example.com", "/missing/"),
		false
	);

	admin.worker.dispose();
	foreign.worker.dispose();
	app.channel.port2.close();
	admin.channel.port2.close();
	foreign.channel.port2.close();
});

test("an unresponsive nested worker cannot hang the outer fetch forever", async () => {
	const { channel, worker } = createWorker("https://example.com", "/app/", 5);

	assert.equal(
		await worker.fetch(new Request("https://example.com/app/data")),
		false
	);
	assert.equal(worker.promises.size, 0);

	worker.dispose();
	channel.port2.close();
});

test("page messages and transferables reach the nested worker runtime", async () => {
	const { channel, worker } = createWorker();
	const received = new Promise((resolve) => {
		channel.port2.addEventListener("message", (event) => {
			if (event.data?.sherpa$type === "message") resolve(event.data);
		});
		channel.port2.start();
	});
	const buffer = new Uint8Array([1, 2, 3]).buffer;

	assert.equal(
		worker.postMessage({ greeting: "hello", buffer }, [buffer]),
		true
	);
	assert.equal(buffer.byteLength, 0);
	const message = await received;
	assert.equal(message.sherpa$data.greeting, "hello");
	assert.deepEqual(
		Array.from(new Uint8Array(message.sherpa$data.buffer)),
		[1, 2, 3]
	);

	worker.dispose();
	channel.port2.close();
	assert.equal(worker.postMessage("late"), false);
});
