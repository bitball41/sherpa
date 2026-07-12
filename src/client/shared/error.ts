import { config, flagEnabled } from "@/shared";
import { unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";

export const enabled = (client: SherpaClient) =>
	flagEnabled("cleanErrors", client.url);

export default function (client: SherpaClient, _self: Self) {
	// v8 only. all we need to do is clean the sherpa urls from stack traces
	const closure = (error, stack) => {
		let newstack = error.stack;

		for (let i = 0; i < stack.length; i++) {
			const url = stack[i].getFileName();

			try {
				if (url.endsWith(config.files.all)) {
					// strip stack frames including sherpa handlers from the trace.
					// `Array.prototype.find` returns the matching line *string*, and
					// `splice(<string>, 1)` coerces it to NaN → 0, so this used to
					// delete the first stack line (usually the error message) and
					// leave the sherpa frame in place. Match by index instead.
					const lines = newstack.split("\n");
					const idx = lines.findIndex((l) => l.includes(url));
					if (idx !== -1) {
						lines.splice(idx, 1);
						newstack = lines.join("\n");
					}
					continue;
				}
			} catch {}

			try {
				newstack = newstack.replaceAll(url, unrewriteUrl(url));
			} catch {}
		}

		return newstack;
	};
	client.Trap("Error.prepareStackTrace", {
		get(_ctx) {
			// this is a funny js quirk. the getter is ran every time you type something in console
			return closure;
		},
		set(_value) {
			// just ignore it if a site tries setting their own. not much we can really do
		},
	});
}
