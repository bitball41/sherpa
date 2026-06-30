import { config } from "@/shared";
import { unrewriteUrl } from "@rewriters/url";

const DEFAULT_REFERRER_POLICY: ReferrerPolicy =
	"strict-origin-when-cross-origin";

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

function isDowngrade(source: URL, target: URL): boolean {
	return source.protocol === "https:" && target.protocol === "http:";
}

function stripReferrer(url: URL, originOnly = false): string {
	const stripped = new URL(url.href);
	stripped.username = "";
	stripped.password = "";
	stripped.hash = "";

	if (originOnly || stripped.href.length > 4096) {
		return `${stripped.origin}/`;
	}

	return stripped.href;
}

export function createRefererHeader(
	context: VirtualRequestContext
): string | null {
	const source = context.referrerUrl;
	if (!source || !["http:", "https:"].includes(source.protocol)) return null;

	const sameOrigin = source.origin === context.targetUrl.origin;
	const downgrade = isDowngrade(source, context.targetUrl);

	switch (context.referrerPolicy) {
		case "no-referrer":
			return null;
		case "origin":
			return stripReferrer(source, true);
		case "unsafe-url":
			return stripReferrer(source);
		case "strict-origin":
			return downgrade ? null : stripReferrer(source, true);
		case "strict-origin-when-cross-origin":
			if (sameOrigin) return stripReferrer(source);

			return downgrade ? null : stripReferrer(source, true);
		case "same-origin":
			return sameOrigin ? stripReferrer(source) : null;
		case "origin-when-cross-origin":
			return stripReferrer(source, !sameOrigin);
		case "no-referrer-when-downgrade":
			return downgrade ? null : stripReferrer(source);
		default:
			if (sameOrigin) return stripReferrer(source);

			return downgrade ? null : stripReferrer(source, true);
	}
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
			return isDowngrade(context.initiatorUrl, context.targetUrl)
				? "null"
				: context.initiatorUrl.origin;
		case "same-origin":
			return context.isSameOrigin ? context.initiatorUrl.origin : "null";
		default:
			return context.initiatorUrl.origin;
	}
}
