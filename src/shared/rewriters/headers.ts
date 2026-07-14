import type {
	default as BareClient,
	BareHeaders,
} from "@mercuryworkshop/bare-mux";
import { rewriteUrl, type URLMeta } from "@rewriters/url";
import { getSiteDirective } from "@/shared/security/siteTests";
import { rewriteLinkHeader } from "@rewriters/linkHeader";
import { rewriteRefresh } from "@rewriters/refresh";
import {
	createReferrerValue,
	DEFAULT_REFERRER_POLICY,
	selectReferrerPolicy,
} from "@/shared/referrerPolicy";

interface StoredReferrerPolicies {
	get(url: string): Promise<{ policy: string; referrer: string } | null>;
	set(url: string, policy: string, referrer: string): Promise<void>;
}

/**
 * Headers for security policy features that haven't been emulated yet
 */
const SEC_HEADERS = new Set([
	"cross-origin-embedder-policy",
	"cross-origin-opener-policy",
	"cross-origin-resource-policy",
	"content-security-policy",
	"content-security-policy-report-only",
	"expect-ct",
	"feature-policy",
	"origin-isolation",
	"strict-transport-security",
	"upgrade-insecure-requests",
	"x-content-type-options",
	"x-download-options",
	"x-frame-options",
	"x-permitted-cross-domain-policies",
	"x-powered-by",
	"x-xss-protection",
	// This needs to be emulated, but for right now it isn't that important of a feature to be worried about
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data
	"clear-site-data",
]);

/**
 * Headers that are actually URLs that need to be rewritten
 */
const URL_HEADERS = new Set(["location", "content-location", "referer"]);

/**
 * Rewrites response headers
 * @param rawHeaders Headers before they were rewritten
 * @param meta Parsed Proxy URL
 * @param client `BareClient` instance used for fetching
 * @param storedReferrerPolicies Referrer policies remembered for proxied origins
 */
export async function rewriteHeaders(
	rawHeaders: BareHeaders,
	meta: URLMeta,
	client: BareClient,
	storedReferrerPolicies: StoredReferrerPolicies
) {
	const headers: BareHeaders = Object.create(null);

	for (const key of Object.keys(rawHeaders)) {
		headers[key.toLowerCase()] = rawHeaders[key];
	}

	for (const cspHeader of SEC_HEADERS) {
		delete headers[cspHeader];
	}

	for (const urlHeader of URL_HEADERS) {
		const value = headers[urlHeader];
		if (typeof value === "string") {
			headers[urlHeader] = rewriteUrl(value, meta);
		} else if (Array.isArray(value)) {
			headers[urlHeader] = value.map((url) => rewriteUrl(url, meta));
		}
	}

	if (typeof headers["link"] === "string") {
		headers["link"] = rewriteLinkHeader(headers["link"], (url) =>
			rewriteUrl(url, meta)
		);
	} else if (Array.isArray(headers["link"])) {
		headers["link"] = headers["link"].map((link) =>
			rewriteLinkHeader(link, (url) => rewriteUrl(url, meta))
		);
	}

	// The `Refresh` response header is the HTTP equivalent of
	// `<meta http-equiv=refresh>` and is honored by browsers the same way, so a
	// URL left un-rewritten here navigates the document straight out of the
	// proxy. Same `<seconds>[; url=<url>]` grammar as the meta tag.
	if (typeof headers["refresh"] === "string") {
		headers["refresh"] = rewriteRefresh(headers["refresh"], (url) =>
			rewriteUrl(url, meta)
		);
	} else if (Array.isArray(headers["refresh"])) {
		headers["refresh"] = headers["refresh"].map((refresh) =>
			rewriteRefresh(refresh, (url) => rewriteUrl(url, meta))
		);
	}

	// Emulate the referrer policy to set it back to what it should've been without Force Referrer in place
	if (typeof headers["referer"] === "string") {
		const referrerUrl = new URL(headers["referer"]);
		const storedPolicyData = await storedReferrerPolicies.get(referrerUrl.href);
		if (storedPolicyData) {
			const policy =
				selectReferrerPolicy(storedPolicyData.policy) ||
				DEFAULT_REFERRER_POLICY;
			const referer = createReferrerValue(policy, referrerUrl, meta.origin);

			if (referer === null) delete headers["referer"];
			else headers["referer"] = referer;
		}
	}
	if (
		typeof headers["sec-fetch-dest"] === "string" &&
		headers["sec-fetch-dest"] === ""
	) {
		headers["sec-fetch-dest"] = "empty";
	}

	if (
		typeof headers["sec-fetch-site"] === "string" &&
		headers["sec-fetch-site"] !== "none"
	) {
		if (typeof headers["referer"] === "string") {
			headers["sec-fetch-site"] = await getSiteDirective(
				meta,
				new URL(headers["referer"]),
				client
			);
		} else {
			console.warn(
				"Missing referrer header; can't rewrite sec-fetch-site properly. Falling back to unsafe deletion."
			);
			delete headers["sec-fetch-site"];
		}
	}

	return headers;
}
