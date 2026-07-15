/**
 * Temporarily exposes the event currently being delivered, preserving nested
 * dispatch and restoring any pre-existing own property even when a listener
 * throws.
 */
export function withCurrentEvent<T>(
	target: object,
	event: unknown,
	callback: () => T
): T {
	const descriptor = Object.getOwnPropertyDescriptor(target, "event");
	let installed = false;

	try {
		Object.defineProperty(target, "event", {
			value: event,
			configurable: true,
		});
		installed = true;
	} catch {
		// Some host globals expose a non-configurable native event property.
	}

	try {
		return callback();
	} finally {
		if (installed) {
			if (descriptor) Object.defineProperty(target, "event", descriptor);
			else Reflect.deleteProperty(target, "event");
		}
	}
}
