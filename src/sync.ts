import { writeSyncResponse } from "@/shared/syncResponse";

function writeXhrResponse(
	sab: SharedArrayBuffer,
	status: number,
	headers: string,
	body: ArrayBuffer | Uint8Array
) {
	try {
		writeSyncResponse(sab, status, headers, body);
	} catch (error) {
		console.error("failed to serialize sync xhr response", error);
		writeSyncResponse(sab, 0, "", new Uint8Array());
	}
}

addEventListener(
	"message",
	({
		data: {
			sab,
			args: [method, url, _, username, password],
			body,
			headers,
		},
	}) => {
		const xhr = new XMLHttpRequest();
		xhr.responseType = "arraybuffer";

		// force async since we need it to resolve to the sw
		xhr.open(method, url, true, username, password);

		if (headers)
			for (const [k, v] of Object.entries(headers)) {
				xhr.setRequestHeader(k, v as string);
			}

		xhr.send(body);

		xhr.onload = () => {
			writeXhrResponse(
				sab,
				xhr.status,
				xhr.getAllResponseHeaders(),
				xhr.response || new ArrayBuffer(0)
			);
		};
		xhr.ontimeout =
			xhr.onerror =
			xhr.onabort =
				() => {
					console.error("xhr failed");
					writeSyncResponse(sab, 0, "", new Uint8Array());
				};
	}
);
