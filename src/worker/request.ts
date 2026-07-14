import { config } from "@/shared";
import { unrewriteUrl } from "@rewriters/url";
import {
	createReferrerValue,
	DEFAULT_REFERRER_POLICY,
} from "@/shared/referrerPolicy";

export type VirtualRequestContext = {
	credentials: RequestCredentials;
	initiatorUrl: URL | null;
	isNavigation: boolean;
	isSameOrigin: boolean;
	method: string;
	mode: RequestMode;
	referrerPolicy: ReferrerPolicy;
	referrerUrl: URL | null;
	targetUrl: URL;
};

function decodeProxyUrl(rawUrl: string | undefined): URL | null {
	if (!rawUrl || rawUrl === "no-referrer") return null;

	const prefix = location.origin + config.prefix;
	if (!rawUrl.startsWith(prefix)) return null;

	try {
		return new URL(unrewriteUrl(rawUrl));
	} catch {
		return null;
	}
}

export function createVirtualRequestContext(
	request: Request,
	client: Client | null,
	targetUrl: URL
): VirtualRequestContext {
	const clientUrl = decodeProxyUrl(client?.url);
	const referrerUrl = decodeProxyUrl(request.referrer);
	const initiatorUrl = clientUrl || referrerUrl;

	return {
		credentials: request.credentials,
		initiatorUrl,
		isNavigation: request.mode === "navigate",
		isSameOrigin: initiatorUrl?.origin === targetUrl.origin,
		method: request.method.toUpperCase(),
		mode: request.mode,
		referrerPolicy: request.referrerPolicy || DEFAULT_REFERRER_POLICY,
		referrerUrl,
		targetUrl,
	};
}

export function shouldSendCookies(context: VirtualRequestContext): boolean {
	return (
		context.isNavigation ||
		context.credentials === "include" ||
		(context.credentials === "same-origin" && context.isSameOrigin)
	);
}

export function createRefererHeader(
	context: VirtualRequestContext
): string | null {
	const source = context.referrerUrl;
	if (!source) return null;

	return createReferrerValue(
		context.referrerPolicy || DEFAULT_REFERRER_POLICY,
		source,
		context.targetUrl
	);
}

export function createOriginHeader(
	context: VirtualRequestContext
): string | null {
	const isCorsRequest = context.mode === "cors" && !context.isSameOrigin;
	const methodRequiresOrigin = !["GET", "HEAD"].includes(context.method);

	if (!isCorsRequest && !methodRequiresOrigin) return null;
	if (!context.initiatorUrl) return "null";
	if (isCorsRequest) return context.initiatorUrl.origin;

	switch (context.referrerPolicy) {
		case "no-referrer":
			return "null";
		case "no-referrer-when-downgrade":
		case "strict-origin":
		case "strict-origin-when-cross-origin":
			return context.initiatorUrl.protocol === "https:" &&
				context.targetUrl.protocol === "http:"
				? "null"
				: context.initiatorUrl.origin;
		case "same-origin":
			return context.isSameOrigin ? context.initiatorUrl.origin : "null";
		default:
			return context.initiatorUrl.origin;
	}
}
