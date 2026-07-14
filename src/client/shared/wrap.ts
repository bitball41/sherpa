import { iswindow } from "@client/entry";
import { SHERPACLIENT } from "@/symbols";
import { SherpaClient } from "@client/index";
import { config } from "@/shared";
// import { argdbg } from "@client/shared/err";
import { indirectEval } from "@client/shared/eval";
import { evaluateAssignment } from "@/shared/assignment";

export function createWrapFn(client: SherpaClient, self: typeof globalThis) {
	return function (identifier: any, strict: boolean) {
		if (identifier === self.location) return client.locationProxy;
		if (identifier === self.eval) return indirectEval.bind(client, strict);

		if (iswindow) {
			if (identifier === self.parent) {
				if (SHERPACLIENT in self.parent) {
					// ... then we're in a subframe, and the parent frame is also in a proxy context, so we should return its proxy
					return self.parent;
				} else {
					// ... then we should pretend we aren't nested and return the current window
					return self;
				}
			} else if (identifier === self.top) {
				// instead of returning top, we need to return the uppermost parent that's inside a sherpa context
				let current = self;

				for (;;) {
					const test = current.parent.self;
					if (test === current) break; // there is no parent, actual or emulated.

					// ... then `test` represents a window outside of the proxy context, and therefore `current` is the topmost window in the proxy context
					if (!(SHERPACLIENT in test)) break;

					// test is also insde a proxy, so we should continue up the chain
					current = test;
				}

				return current;
			}
		}

		return identifier;
	};
}

export const order = 4;
export default function (client: SherpaClient, self: typeof globalThis) {
	Object.defineProperty(self, config.globals.wrapfn, {
		value: client.wrapfn,
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object.defineProperty(self, config.globals.wrappropertyfn, {
		value: function (str) {
			if (
				str === "location" ||
				str === "parent" ||
				str === "top" ||
				str === "eval"
			)
				return config.globals.wrappropertybase + str;

			return str;
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object.defineProperty(self, config.globals.cleanrestfn, {
		value: function (_obj) {
			// TODO
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});

	Object.defineProperty(
		self.Object.prototype,
		config.globals.wrappropertybase + "location",
		{
			get: function () {
				// if (this.location.constructor.toString().includes("Location")) {

				if (this === self || this === self.document) {
					return client.locationProxy;
				}

				return this.location;
			},
			set(value: any) {
				if (this === self || this === self.document) {
					client.url = value;

					return;
				}
				this.location = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object.defineProperty(
		self.Object.prototype,
		config.globals.wrappropertybase + "parent",
		{
			get: function () {
				return client.wrapfn(this.parent, false);
			},
			set(value: any) {
				// i guess??
				this.parent = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object.defineProperty(
		self.Object.prototype,
		config.globals.wrappropertybase + "top",
		{
			get: function () {
				return client.wrapfn(this.top, false);
			},
			set(value: any) {
				this.top = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object.defineProperty(
		self.Object.prototype,
		config.globals.wrappropertybase + "eval",
		{
			get: function () {
				return client.wrapfn(this.eval, true);
			},
			set(value: any) {
				this.eval = value;
			},
			configurable: false,
			enumerable: false,
		}
	);

	self.$scramitize = function (value) {
		return value;
	};

	// location = "..." can't be rewritten as wrapfn(location) = ..., so instead it will actually be rewritten as
	// ((t)=>$sherpa$tryset(location,"+=",t)||location+=t)(...);
	// it has to be a discrete function because there's always the possibility that "location" is a local variable
	// we have to use an IIFE to avoid duplicating side-effects in the getter
	Object.defineProperty(self, config.globals.trysetfn, {
		value: function (lhs: any, op: string, rhs: any) {
			const locationClient = client.box.locations.get(lhs);
			if (locationClient) {
				const result = evaluateAssignment(
					locationClient.locationProxy.href,
					op,
					rhs
				);
				if (result.assign) locationClient.locationProxy.href = result.value;

				return true;
			}

			return false;
		},
		writable: false,
		configurable: false,
	});
}
