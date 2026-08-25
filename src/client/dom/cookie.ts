import type { MessageW2C } from "@/worker";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, self: typeof window) {
	client.serviceWorker.addEventListener(
		"message",
		({ data }: { data: MessageW2C }) => {
			if (typeof data !== "object" || data === null || !("scramjet$type" in data))
				return;

			if (data.scramjet$type === "cookie") {
				client.cookieStore.setCookies([data.cookie], new URL(data.url));
				const msg = {
					scramjet$token: data.scramjet$token,
					scramjet$type: "cookie",
				};
				client.serviceWorker.controller.postMessage(msg);
			}
		}
	);

	client.Trap("Document.prototype.cookie", {
		get() {
			return client.cookieStore.getCookies(client.url, true);
		},
		set(ctx, value: string) {
			client.cookieStore.setCookies([value], client.url, true);
			const controller = client.descriptors.get(
				"ServiceWorkerContainer.prototype.controller",
				client.serviceWorker
			);
			if (controller) {
				client.natives.call("ServiceWorker.prototype.postMessage", controller, {
					scramjet$type: "cookie",
					cookie: value,
					url: client.url.href,
					fromJs: true,
				});
			}
		},
	});

	// @ts-ignore
	delete self.cookieStore;
}
