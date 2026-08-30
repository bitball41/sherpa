export type LegacyWindowMessageEnvelope = {
	$scramjet$messagetype: "window";
	$scramjet$origin: string;
	$scramjet$data: unknown;
};

export type WindowMessageEnvelope = LegacyWindowMessageEnvelope & {
	$scramjet$targetOrigin: string;
};

export type WorkerMessageEnvelope = {
	$scramjet$messagetype: "worker";
	$scramjet$data: unknown;
};

export type VirtualMessageEnvelope =
	| LegacyWindowMessageEnvelope
	| WindowMessageEnvelope
	| WorkerMessageEnvelope;

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

export function isLegacyWindowMessageEnvelope(
	value: unknown
): value is LegacyWindowMessageEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<LegacyWindowMessageEnvelope>)
			.$scramjet$messagetype === "window" &&
		typeof (value as Partial<LegacyWindowMessageEnvelope>)
			.$scramjet$origin === "string" &&
		hasOwn(value, "$scramjet$data")
	);
}

export function isWindowMessageEnvelope(
	value: unknown
): value is WindowMessageEnvelope {
	return (
		isLegacyWindowMessageEnvelope(value) &&
		typeof (value as Partial<WindowMessageEnvelope>)
			.$scramjet$targetOrigin === "string"
	);
}

export function isWorkerMessageEnvelope(
	value: unknown
): value is WorkerMessageEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<WorkerMessageEnvelope>).$scramjet$messagetype ===
			"worker" &&
		hasOwn(value, "$scramjet$data")
	);
}

export function isVirtualMessageEnvelope(
	value: unknown
): value is VirtualMessageEnvelope {
	return (
		isLegacyWindowMessageEnvelope(value) || isWorkerMessageEnvelope(value)
	);
}

/** Resolve the page's virtual target before widening the physical call. */
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
		throw new TypeError(
			"postMessage targetOrigin could not be converted to a string"
		);
	}
	if (serialized === "*") return serialized;

	try {
		return new URL(serialized).origin;
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
		envelope.$scramjet$targetOrigin === "*" ||
		envelope.$scramjet$targetOrigin === receiverOrigin
	);
}
