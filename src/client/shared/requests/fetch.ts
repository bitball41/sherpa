import { isemulatedsw } from "@client/entry";
import { rewriteUrl, unrewriteUrl } from "@rewriters/url";
import { SherpaClient } from "@client/index";
import { appendUrlParams } from "@/shared/urlCodec";
import { INTERNAL_PARAMS } from "@/shared/internalParams";

const objectToString = Object.prototype.toString;

export default function (client: SherpaClient) {
	const nativeRequest = client.natives.store["Request"] as typeof Request;

	/**
	 * `fetch()`/`new Request()` take a `RequestInfo`: either a `Request` (used
	 * as-is, and already rewritten when it was constructed) or *anything else*,
	 * which WebIDL stringifies into a URL.
	 *
	 * Only strings and `URL`s used to be rewritten, so any other object with a
	 * useful `toString` - an `<a>` element, a `Location`, a URL-like wrapper
	 * from a framework - was handed to the native call untouched. That resolves
	 * to the site's real, unproxied URL, which then escapes the proxy entirely:
	 * the request leaves the page for the origin, and fails CORS instead of
	 * being served.
	 */
	function rewriteRequestInfo(args: any[]) {
		if (args.length === 0) return;

		const input = args[0];
		if (input === undefined || input === null) return;
		if (nativeRequest && input instanceof nativeRequest) return;
		// `instanceof` misses a Request that came from another realm (a parent
		// frame's `fetch` helper, say); its brand check does not.
		if (
			typeof input === "object" &&
			objectToString.call(input) === "[object Request]"
		)
			return;

		args[0] = rewriteUrl(String(input), client.meta);

		if (isemulatedsw)
			args[0] = appendUrlParams(args[0], {
				[INTERNAL_PARAMS.from]: "swruntime",
			});
	}

	client.Proxy("fetch", {
		apply(ctx) {
			rewriteRequestInfo(ctx.args);
		},
	});

	client.Proxy("Request", {
		construct(ctx) {
			rewriteRequestInfo(ctx.args);
		},
	});

	client.Trap("Response.prototype.url", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});

	client.Trap("Request.prototype.url", {
		get(ctx) {
			return unrewriteUrl(ctx.get() as string);
		},
	});
}
