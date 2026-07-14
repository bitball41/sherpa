export type WindowMessageEnvelope = {
	$sherpa$messagetype: "window";
	$sherpa$origin: string;
	$sherpa$targetOrigin: string;
	$sherpa$data: unknown;
};

export type WorkerMessageEnvelope = {
	$sherpa$messagetype: "worker";
	$sherpa$data: unknown;
};

export type VirtualMessageEnvelope =
	| WindowMessageEnvelope
	| WorkerMessageEnvelope;

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

export function isWindowMessageEnvelope(
	value: unknown
): value is WindowMessageEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<WindowMessageEnvelope>).$sherpa$messagetype ===
			"window" &&
		typeof (value as Partial<WindowMessageEnvelope>).$sherpa$origin ===
			"string" &&
		typeof (value as Partial<WindowMessageEnvelope>).$sherpa$targetOrigin ===
			"string" &&
		hasOwn(value, "$sherpa$data")
	);
}

export function isWorkerMessageEnvelope(
	value: unknown
): value is WorkerMessageEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<WorkerMessageEnvelope>).$sherpa$messagetype ===
			"worker" &&
		hasOwn(value, "$sherpa$data")
	);
}

export function isVirtualMessageEnvelope(
	value: unknown
): value is VirtualMessageEnvelope {
	return isWindowMessageEnvelope(value) || isWorkerMessageEnvelope(value);
}

/**
 * Resolve postMessage's virtual target origin before the physical call is
 * widened to `*`. The default and `/` both mean the caller's own origin.
 */
export function normalizePostMessageTargetOrigin(
	value: unknown,
	source: string | URL
): string {
	const sourceUrl = source instanceof URL ? source : new URL(source);
	if (value === undefined || value === "/") return sourceUrl.origin;

	let serialized: string;
	try {
		serialized = `${value}`;
	} catch {
		throw new TypeError("postMessage targetOrigin could not be converted to a string");
	}
	if (serialized === "*") return serialized;

	try {
		return new URL(serialized, sourceUrl).origin;
	} catch {
		throw new DOMException(
			`Failed to execute 'postMessage': '${serialized}' is not a valid target origin`,
			"SyntaxError"
		);
	}
}

export function shouldDeliverWindowMessage(
	envelope: WindowMessageEnvelope,
	receiverOrigin: string
): boolean {
	return (
		envelope.$sherpa$targetOrigin === "*" ||
		envelope.$sherpa$targetOrigin === receiverOrigin
	);
}
