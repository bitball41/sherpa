import { iswindow } from "@client/entry";
import { SHERPACLIENT } from "@/symbols";
import { SherpaClient } from "@client/index";
import { POLLUTANT } from "@client/shared/realm";
import { normalizePostMessageTargetOrigin } from "@/shared/postMessage";

export default function (client: SherpaClient) {
	if (iswindow)
		client.Proxy("window.postMessage", {
			apply(ctx) {
				// so we need to send the real origin here, since the recieving window can't possibly know.
				// except, remember that this code is being ran in a different realm than the invoker, so if we ask our `client` it may give us the wrong origin
				// if we were given any object that came from the real realm we can use that to get the real origin
				// and this works in every case EXCEPT for the fact that all three arguments can be strings which are copied instead of cloned
				// so we have to use `$setrealm` which will pollute this with an object from the real realm

				let pollutant;

				if (typeof ctx.args[0] === "object" && ctx.args[0] !== null) {
					pollutant = ctx.args[0]; // try to use the first object we can find because it's more reliable
				} else if (typeof ctx.args[2] === "object" && ctx.args[2] !== null) {
					pollutant = ctx.args[2]; // next try to use transfer
				} else if (
					ctx.this &&
					POLLUTANT in ctx.this &&
					typeof ctx.this[POLLUTANT] === "object" &&
					ctx.this[POLLUTANT] !== null
				) {
					pollutant = ctx.this[POLLUTANT]; // lastly try to use the object from $setrealm
				} else {
					pollutant = {}; // give up
				}

				// and now we can steal Function from the caller's realm
				const {
					constructor: { constructor: Function },
				} = pollutant;

				// invoking stolen function will give us the caller's globalThis, remember sherpa has already proxied it!!!
				const callerGlobalThisProxied: Self = Function("return globalThis")();
				const callerClient = callerGlobalThisProxied[SHERPACLIENT];
				const targetOptions = ctx.args[1];
				const usesOptions =
					typeof targetOptions === "object" && targetOptions !== null;
				const targetOrigin = normalizePostMessageTargetOrigin(
					usesOptions ? targetOptions.targetOrigin : targetOptions,
					callerClient.url
				);

				// this WOULD be enough but the source argument of MessageEvent has to return the caller's window
				// and if we just call it normally it would be coming from here, which WILL NOT BE THE CALLER'S because the accessor is from the parent
				// so with the stolen function we wrap postmessage so the source will truly be the caller's window (remember that function is sherpa's!!!)
				const wrappedPostMessage = Function("...args", "this(...args)");

				ctx.args[0] = {
					$sherpa$messagetype: "window",
					$sherpa$origin: callerClient.url.origin,
					$sherpa$targetOrigin: targetOrigin,
					$sherpa$data: ctx.args[0],
				};

				// Every virtual origin shares the physical proxy origin. Widen only
				// the physical delivery, then enforce the original virtual target in
				// the receiving realm before any application listener is invoked.
				if (usesOptions) {
					ctx.args[1] = {
						targetOrigin: "*",
						transfer: targetOptions.transfer,
					};
				} else {
					ctx.args[1] = "*";
				}

				ctx.return(wrappedPostMessage.call(ctx.fn, ...ctx.args));
			},
		});

	const toproxy = ["MessagePort.prototype.postMessage"];

	if (self.Worker) toproxy.push("Worker.prototype.postMessage");
	if (!iswindow) toproxy.push("self.postMessage"); // only do the generic version if we're in a worker

	client.Proxy(toproxy, {
		apply(ctx) {
			// origin/source doesn't need to be preserved - it's null in the message event

			ctx.args[0] = {
				$sherpa$messagetype: "worker",
				$sherpa$data: ctx.args[0],
			};
		},
	});
}
