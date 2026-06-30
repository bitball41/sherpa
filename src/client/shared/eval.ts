import { config } from "@/shared";
import { rewriteJs } from "@rewriters/js";
import { SherpaClient } from "@client/index";

export default function (client: SherpaClient, self: Self) {
	// used for proxying *direct eval*
	// eval("...") -> eval($sherpa$rewrite("..."))
	Object.defineProperty(self, config.globals.rewritefn, {
		value: function (js: any) {
			if (typeof js !== "string") return js;

			const rewritten = rewriteJs(js, "(direct eval proxy)", client.meta);

			return rewritten;
		},
		writable: false,
		configurable: false,
	});
}

export function indirectEval(this: SherpaClient, strict: boolean, js: any) {
	// > If the argument of eval() is not a string, eval() returns the argument unchanged
	if (typeof js !== "string") return js;

	let indirection: typeof eval;
	if (this.url.hostname === "accounts.google.com") {
		console.log("USING STRICT EVAL - BOTGUARD");
		indirection = new Function(`
			"use strict";
			return eval;
		`) as typeof eval;
	} else {
		indirection = this.global.eval;
	}

	return indirection(
		rewriteJs(js, "(indirect eval proxy)", this.meta) as string
	);
}
