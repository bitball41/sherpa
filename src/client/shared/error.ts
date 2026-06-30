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
					// strip stack frames including sherpa handlers from the trace
					const lines = newstack.split("\n");
					const line = lines.find((l) => l.includes(url));
					lines.splice(line, 1);
					newstack = lines.join("\n");
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
