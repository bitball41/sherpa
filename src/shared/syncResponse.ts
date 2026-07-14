const STATUS_OFFSET = 1;
const HEADERS_LENGTH_OFFSET = 3;
const HEADERS_OFFSET = 7;

type GrowableSharedArrayBuffer = SharedArrayBuffer & {
	grow?: (newByteLength: number) => void;
};

export type SyncResponsePayload = {
	status: number;
	headers: string;
	body: Uint8Array<ArrayBuffer>;
};

/** Writes one complete response before atomically releasing the reader lock. */
export function writeSyncResponse(
	sab: SharedArrayBuffer,
	status: number,
	headers: string,
	body: ArrayBuffer | Uint8Array
): void {
	const encodedHeaders = new TextEncoder().encode(headers);
	const bodyBytes = body instanceof Uint8Array ? body : new Uint8Array(body);
	const bodyLengthOffset = HEADERS_OFFSET + encodedHeaders.byteLength;
	const bodyOffset = bodyLengthOffset + 4;
	const requiredLength = bodyOffset + bodyBytes.byteLength;

	if (sab.byteLength < requiredLength) {
		const growable = sab as GrowableSharedArrayBuffer;
		if (typeof growable.grow !== "function") {
			throw new RangeError("sync XHR response exceeds its fixed shared buffer");
		}
		growable.grow(requiredLength);
	}

	// Views created before SharedArrayBuffer.grow() keep their original length.
	// Construct them only after the final size is known.
	const view = new DataView(sab);
	const bytes = new Uint8Array(sab);
	view.setUint16(STATUS_OFFSET, status);
	view.setUint32(HEADERS_LENGTH_OFFSET, encodedHeaders.byteLength);
	bytes.set(encodedHeaders, HEADERS_OFFSET);
	view.setUint32(bodyLengthOffset, bodyBytes.byteLength);
	bytes.set(bodyBytes, bodyOffset);

	// Publishing the lock last ensures the main thread cannot observe a partial
	// frame. Atomics also gives the write/read pair an explicit memory barrier.
	Atomics.store(bytes, 0, 1);
}

/** Reads a response after the writer has released byte zero. */
export function readSyncResponse(sab: SharedArrayBuffer): SyncResponsePayload {
	const view = new DataView(sab);
	const status = view.getUint16(STATUS_OFFSET);
	const headersLength = view.getUint32(HEADERS_LENGTH_OFFSET);
	const bodyLengthOffset = HEADERS_OFFSET + headersLength;
	const bodyOffset = bodyLengthOffset + 4;

	if (bodyOffset > sab.byteLength) {
		throw new RangeError("invalid sync XHR header length");
	}

	const bodyLength = view.getUint32(bodyLengthOffset);
	if (bodyOffset + bodyLength > sab.byteLength) {
		throw new RangeError("invalid sync XHR body length");
	}

	const headers = new TextDecoder().decode(
		new Uint8Array(sab, HEADERS_OFFSET, headersLength)
	);
	const body = new Uint8Array(bodyLength);
	body.set(new Uint8Array(sab, bodyOffset, bodyLength));

	return { status, headers, body };
}
