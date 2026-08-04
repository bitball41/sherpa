const BASE64_CHUNK_SIZE = 8192;

// Uint8Array.fromBase64/toBase64 (TC39 "Uint8Array from base64", Chrome 140+,
// Safari 18.2+, Node 24+) do this conversion in the engine. It matters: every
// proxied document decodes the ~534 KiB rewriter WASM out of base64 during
// client boot, which is the single biggest main-thread block in a warm load,
// and the JS loop below is roughly an order of magnitude slower. Detected once
// rather than per call.
type Base64Statics = {
	fromBase64?: (value: string) => Uint8Array<ArrayBuffer>;
};
type Base64Instance = {
	toBase64?: () => string;
};

const nativeFromBase64 = (Uint8Array as unknown as Base64Statics).fromBase64;
const nativeToBase64 = (Uint8Array.prototype as unknown as Base64Instance)
	.toBase64;

export function bytesToBase64(bytes: Uint8Array): string {
	if (nativeToBase64) return nativeToBase64.call(bytes);

	let binary = "";
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
		binary += String.fromCharCode.apply(
			null,
			bytes.subarray(i, i + BASE64_CHUNK_SIZE) as unknown as number[]
		);
	}

	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	if (nativeFromBase64) return nativeFromBase64(base64);

	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}
