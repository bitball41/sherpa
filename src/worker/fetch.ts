import BareClient, { BareResponseFetch } from "@mercuryworkshop/bare-mux";
import { MessageW2C, SherpaServiceWorker } from "@/worker";
import { renderError } from "@/worker/error";
import { CookieStore } from "@/shared/cookie";

import { getSiteDirective } from "@/shared/security/siteTests";
import { isSameSiteContext } from "@/shared/security/siteContext";
import {
	initializeTracker,
	updateTracker,
	cleanTracker,
	getMostRestrictiveSite,
	storeReferrerPolicy,
	getReferrerPolicy,
} from "@/shared/security/forceReferrer";

import { unrewriteBlob, unrewriteUrl, type URLMeta } from "@rewriters/url";
import { rewriteJs } from "@rewriters/js";
import { flattenResponseHeaders, SherpaHeaders } from "@/shared/headers";
import { config, flagEnabled } from "@/shared";
import { rewriteHeaders } from "@rewriters/headers";
import { bytesToBase64, rewriteHtml } from "@rewriters/html";
import { rewriteCss } from "@rewriters/css";
import { rewriteWorkers } from "@rewriters/worker";
import { SherpaDownload } from "@client/events";
import {
	createOriginHeader,
	createRefererHeader,
	createVirtualRequestContext,
	shouldSendCookies,
} from "@/worker/request";
import { retryTransientHttp2Request } from "@/worker/retry";
import { getDB } from "@/shared/security/db";
import {
	isHtmlContentType,
	isRedirectStatus,
	normalizeHtmlContentType,
} from "@/worker/response";
import {
	appendUrlParamEntries,
	appendUrlParams,
	extractUrlParams,
} from "@/shared/urlCodec";

async function fetchWithTransientRetry(
	client: BareClient,
	url: URL,
	init: RequestInit
): Promise<BareResponseFetch> {
	return retryTransientHttp2Request(
		() => client.fetch(url, init) as Promise<BareResponseFetch>,
		init.method || "GET",
		init.body != null
	);
}

let cachedWasmPayload: Promise<string> | null = null;
let cachedWasmPayloadPath: string | null = null;

// displayable mime types, checked as a download fallback
const displayableMimes = [
	// Text types
	"text/html",
	"text/plain",
	"text/css",
	"text/javascript",
	"text/xml",
	"application/javascript",
	"application/json",
	"application/xml",
	"application/pdf",
];

function isDownload(responseHeaders: object, destination: string): boolean {
	if (["document", "iframe"].includes(destination)) {
		const disposition = responseHeaders["content-disposition"];
		const header = Array.isArray(disposition) ? disposition[0] : disposition;
		if (header) {
			// Content-Disposition is `<type>[; params]`; only the leading type
			// token decides inline vs. attachment. Comparing the whole header to
			// "inline" missed the common `inline; filename="..."` form (e.g. a PDF
			// a server wants shown in-browser) and forced it into a download.
			const dispositionType = header.split(";")[0].trim().toLowerCase();

			return dispositionType !== "inline";
		} else {
			// check mime type as fallback
			const rawContentType = responseHeaders["content-type"];
			const contentType = (
				Array.isArray(rawContentType) ? rawContentType[0] : rawContentType
			)
				?.split(";")[0]
				.trim()
				.toLowerCase();
			if (
				contentType &&
				!displayableMimes.includes(contentType) &&
				!contentType.startsWith("text") &&
				!contentType.startsWith("image") &&
				!contentType.startsWith("font") &&
				!contentType.startsWith("video") &&
				!contentType.startsWith("audio")
			) {
				return true;
			}
		}
	}

	return false;
}

export async function handleFetch(
	this: SherpaServiceWorker,
	request: Request,
	client: Client | null
) {
	try {
		const extractedRequest = extractUrlParams(request.url);
		const requestUrl = new URL(extractedRequest.url);

		if (requestUrl.pathname === this.config.files.wasm) {
			// this bootstrap script is requested by every proxied document, and
			// base64-ing the ~0.5 MB rewriter used to happen on each one - build
			// the payload once per worker lifetime and share it
			if (cachedWasmPayloadPath !== this.config.files.wasm) {
				const wasmPath = this.config.files.wasm;
				cachedWasmPayloadPath = wasmPath;
				cachedWasmPayload = fetch(wasmPath).then(async (x) => {
					if (!x.ok) {
						throw new Error(
							`failed to fetch rewriter wasm: HTTP ${x.status} ${x.statusText}`
						);
					}
					const b64 = bytesToBase64(new Uint8Array(await x.arrayBuffer()));

					return (
						"if ('document' in self && document.currentScript) { document.currentScript.remove(); }\n" +
						`self.WASM = '${b64}';`
					);
				});
				// don't pin a transient fetch failure for the worker's lifetime
				cachedWasmPayload.catch(() => {
					if (cachedWasmPayloadPath === wasmPath) {
						cachedWasmPayloadPath = null;
						cachedWasmPayload = null;
					}
				});
			}

			return new Response(await cachedWasmPayload, {
				headers: { "content-type": "text/javascript" },
			});
		}

		// Error-page preview. Navigating to `${prefix}$error` renders the themed
		// error page with a representative sample trace, so developers can preview
		// their `errorPage` customization without triggering a real fetch failure.
		// `SherpaController.errorPreviewUrl` returns this URL.
		if (requestUrl.pathname === this.config.prefix + "$error") {
			const sampleTrace = [
				"Message: Failed to fetch",
				"Url: https://example.com/",
				"Destination: document",
				"Stack: TypeError: Failed to fetch\n    at Sherpa error-page preview",
			].join("\n\n");

			return renderError(sampleTrace, "https://example.com/");
		}

		let scriptType = "";
		let topFrameName;
		let parentFrameName;
		let fromServiceWorkerRuntime = false;

		const extraParams: Array<[string, string]> = [];
		if (extractedRequest.params) {
			const params = extractedRequest.params;
			scriptType = params.type ?? "";
			fromServiceWorkerRuntime = params.from === "swruntime";
			topFrameName = params.topFrame;
			parentFrameName = params.parentFrame;
		} else {
			// Backward compatibility for requests created by a client bundle from
			// before marked metadata existed. New requests never inspect the target's
			// query parameters as controls.
			for (const [param, value] of [...requestUrl.searchParams.entries()]) {
				switch (param) {
					case "type":
						scriptType = value;
						break;
					case "dest":
						break;
					case "scope":
						break;
					case "from":
						fromServiceWorkerRuntime = value === "swruntime";
						break;
					case "topFrame":
						topFrameName = value;
						break;
					case "parentFrame":
						parentFrameName = value;
						break;
					default:
						dbg.warn(
							`${requestUrl.href} extraneous query parameter ${param}. Assuming <form> element`
						);
						extraParams.push([param, value]);
						break;
				}
				requestUrl.searchParams.delete(param);
			}
		}

		const url = new URL(unrewriteUrl(requestUrl));
		// now that we're past unrewriting it's safe to add back the params
		appendUrlParamEntries(url, extraParams);

		const meta: URLMeta = {
			origin: url,
			base: url,
			topFrameName,
			parentFrameName,
		};

		if (
			requestUrl.pathname.startsWith(`${this.config.prefix}blob:`) ||
			requestUrl.pathname.startsWith(`${this.config.prefix}data:`)
		) {
			let dataUrl = requestUrl.pathname.substring(this.config.prefix.length);
			if (dataUrl.startsWith("blob:")) {
				dataUrl = unrewriteBlob(dataUrl);
			}

			const response: Partial<BareResponseFetch> = await fetch(dataUrl, {});
			const url = dataUrl.startsWith("blob:") ? dataUrl : "(data url)";
			response.finalURL = url;
			let body: BodyType;
			const headers = Object.fromEntries(response.headers.entries());

			if (response.body) {
				body = await rewriteBody(
					response as BareResponseFetch,
					meta,
					request.destination,
					scriptType,
					this.cookieStore,
					headers
				);
			}

			if (crossOriginIsolated) {
				headers["Cross-Origin-Opener-Policy"] = "same-origin";
				headers["Cross-Origin-Embedder-Policy"] = "require-corp";
			}

			return new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers: headers,
			});
		}

		// A request is only handled by a service worker whose registered scope
		// is a path-prefix of the request URL. When multiple registered workers
		// match, the one with the longest (most specific) scope wins, per spec.
		const matchingWorkers = this.serviceWorkers.filter(
			(w) =>
				w.connected &&
				w.origin === url.origin &&
				url.pathname.startsWith(w.scope)
		);
		const activeWorker = matchingWorkers.sort(
			(a, b) => b.scope.length - a.scope.length
		)[0];

		if (activeWorker && !fromServiceWorkerRuntime) {
			const r = await activeWorker.fetch(request);
			if (r) {
				// A fake-SW response is a fresh navigable/subresource the worker
				// serves directly, bypassing the header re-stamping in
				// handleResponse. When we're cross-origin isolated it must
				// re-assert COOP+COEP too, or Chrome blocks a new-tab/popup
				// navigation to it with ERR_BLOCKED_BY_RESPONSE: an isolated
				// opener can only keep an equally-isolated popup.
				if (
					crossOriginIsolated &&
					[
						"document",
						"iframe",
						"worker",
						"sharedworker",
						"style",
						"script",
					].includes(request.destination)
				) {
					r.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
					r.headers.set("Cross-Origin-Opener-Policy", "same-origin");
				}

				return r;
			}
		}
		if (url.origin === new URL(request.url).origin) {
			throw new Error(
				"attempted to fetch from same origin - this means the site has obtained a reference to the real origin, aborting"
			);
		}

		const headers = new SherpaHeaders();
		for (const [key, value] of request.headers.entries()) {
			headers.set(key, value);
		}

		const requestContext = createVirtualRequestContext(request, client, url);
		headers.delete("Referer");
		headers.delete("Origin");
		// Never forward ambient cookies belonging to the proxy origin. The
		// virtual cookie jar below is the only source of upstream Cookie headers.
		headers.delete("Cookie");

		const referer = createRefererHeader(requestContext);
		if (referer) headers.set("Referer", referer);

		const origin = createOriginHeader(requestContext);
		if (origin) headers.set("Origin", origin);

		// Check if we should emulate a top-level navigation
		let isTopLevelProxyNavigation = false;
		if (
			request.destination === "iframe" &&
			request.mode === "navigate" &&
			request.referrer &&
			request.referrer !== "no-referrer" &&
			request.referrer !== location.origin + config.prefix + "no-referrer"
		) {
			// Trace back through the referrer chain, checking if each was an iframe navigation using the clients, until we find a non-iframe parent on a non-proxy page
			let currentReferrer = request.referrer;
			const allClients = await self.clients.matchAll({ type: "window" });

			// Trace backwards
			while (currentReferrer) {
				if (!currentReferrer.includes(config.prefix)) {
					isTopLevelProxyNavigation = true;
					break;
				}

				// Find the parent for this iteration
				const parentChainClient = allClients.find(
					(c) => c.url === currentReferrer
				);

				// Get the next referrer policy that applies to this parent
				// eslint-disable-next-line no-await-in-loop
				const parentPolicyData = await getReferrerPolicy(currentReferrer);

				if (!parentPolicyData || !parentPolicyData.referrer) {
					// Check if this ends at the proxy origin
					if (
						parentChainClient &&
						currentReferrer.startsWith(location.origin)
					) {
						isTopLevelProxyNavigation = true;
					}
					// Results are inclusive
					break;
				}

				// Check if this was an iframe navigation by looking at the client
				if (parentChainClient && parentChainClient.frameType === "nested") {
					// Continue checking the chain
					currentReferrer = parentPolicyData.referrer;
				} else {
					// Results are inclusive
					break;
				}
			}
		}

		if (isTopLevelProxyNavigation) {
			headers.set("Sec-Fetch-Dest", "document");
			headers.set("Sec-Fetch-Mode", "navigate");
		} else {
			// Convert empty destination to "empty" string per spec
			headers.set("Sec-Fetch-Dest", request.destination || "empty");
			headers.set("Sec-Fetch-Mode", request.mode);
		}

		let siteDirective = "none";
		if (requestContext.initiatorUrl) {
			siteDirective = await getSiteDirective(
				meta,
				requestContext.initiatorUrl,
				this.client
			);
		}

		const cookies = shouldSendCookies(requestContext)
			? this.cookieStore.getCookies(url, false, {
					// A "none" directive (address bar / bookmark / stripped referrer)
					// is a first-party context for the target, so Strict cookies must
					// flow; only "cross-site" restricts SameSite cookies.
					sameSite: isSameSiteContext(siteDirective),
					topLevelNavigation:
						request.destination === "document" || isTopLevelProxyNavigation,
					method: requestContext.method,
				})
			: "";

		if (cookies.length) headers.set("Cookie", cookies);

		await initializeTracker(
			url.toString(),
			requestContext.referrerUrl?.href || null,
			siteDirective
		);

		headers.set(
			"Sec-Fetch-Site",
			await getMostRestrictiveSite(url.toString(), siteDirective)
		);

		const ev = new SherpaRequestEvent(
			url,
			headers.headers,
			request.body,
			request.method,
			request.destination,
			client
		);
		this.dispatchEvent(ev);

		const response =
			(await ev.response) ||
			(await fetchWithTransientRetry(this.client, ev.url, {
				method: ev.method,
				body: ev.body,
				headers: ev.requestHeaders,
				// Never let the transport attach ambient proxy-origin credentials.
				// Virtual credentials were resolved into the request headers above.
				credentials: "omit",
				mode: request.mode === "cors" ? request.mode : "same-origin",
				cache: request.cache,
				redirect: "manual",
				// @ts-ignore why the fuck is this not typed microsoft
				duplex: "half",
			}));
		response.finalURL = ev.url.href;

		return await handleResponse(
			url,
			meta,
			scriptType,
			request.destination,
			request.mode,
			response,
			this.cookieStore,
			client,
			this.client,
			this,
			requestContext.referrerUrl?.href || ""
		);
	} catch (err) {
		let message = "Unknown error";
		try {
			message = err instanceof Error ? err.message : String(err);
		} catch {
			// A rejected Proxy can throw from both instanceof and string coercion.
		}

		const errorDetails: Record<string, unknown> = {
			message,
			url: request.url,
			destination: request.destination,
		};
		if (typeof err === "object" && err !== null) {
			try {
				const cause = (err as { cause?: unknown }).cause;
				if (cause !== undefined) {
					errorDetails.cause = cause;
					if (cause instanceof AggregateError) {
						errorDetails.causeErrors = cause.errors;
					}
				}
			} catch {
				// Treat hostile error metadata as absent.
			}
			try {
				const stack = (err as { stack?: unknown }).stack;
				if (stack) errorDetails.stack = stack;
			} catch {
				// Treat hostile error metadata as absent.
			}
		}

		console.error("ERROR FROM SERVICE WORKER FETCH: ", errorDetails);
		console.error(err);

		if (!["document", "iframe"].includes(request.destination))
			return new Response(undefined, { status: 500 });

		const formattedError = Object.entries(errorDetails)
			.map(([key, value]) => {
				let printable = "[unprintable]";
				try {
					printable = String(value);
				} catch {
					// Keep the error page available for hostile rejection values.
				}

				return `${key.charAt(0).toUpperCase() + key.slice(1)}: ${printable}`;
			})
			.join("\n\n");

		return renderError(formattedError, unrewriteUrl(request.url));
	}
}

async function handleResponse(
	url: URL,
	meta: URLMeta,
	scriptType: string,
	destination: RequestDestination,
	mode: RequestMode,
	response: BareResponseFetch,
	cookieStore: CookieStore,
	client: Client,
	bareClient: BareClient,
	swtarget: SherpaServiceWorker,
	referrer: string
): Promise<Response> {
	let responseBody: BodyType;
	// response.rawHeaders = {};
	// for (let h of response.raw_headers) {
	// 	const key = h[0];
	// 	const value = h[1];
	// 	if (response.rawHeaders[key] === undefined) {
	// 		response.rawHeaders[key] = value;
	// 	} else if (Array.isArray(response.rawHeaders[key])) {
	// 		(response.rawHeaders[key] as string[]).push(value);
	// 	} else {
	// 		response.rawHeaders[key] = [response.rawHeaders[key] as string, value];
	// 	}
	// }
	const isNavigationRequest =
		mode === "navigate" && ["document", "iframe"].includes(destination);
	const rewrittenHeaders = await rewriteHeaders(
		response.rawHeaders,
		meta,
		bareClient,
		{ get: getReferrerPolicy, set: storeReferrerPolicy }
	);
	const responseHeaders = flattenResponseHeaders(rewrittenHeaders);
	const maybeSetCookies = rewrittenHeaders["set-cookie"] || [];
	const setCookies = Array.isArray(maybeSetCookies)
		? maybeSetCookies
		: [maybeSetCookies];
	const isRedirectResponse =
		isRedirectStatus(response.status) &&
		responseHeaders["location"] !== undefined &&
		responseHeaders["location"].length > 0;

	// Store referrer policy from navigation responses for Force Referrer
	if (isNavigationRequest && responseHeaders["referrer-policy"] && referrer) {
		await storeReferrerPolicy(
			url.href,
			responseHeaders["referrer-policy"],
			referrer
		);
	}

	if (isRedirectResponse) {
		const redirectUrl = new URL(unrewriteUrl(responseHeaders["location"]));

		await updateTracker(
			url.toString(),
			redirectUrl.toString(),
			responseHeaders["referrer-policy"]
		);

		const redirectMeta = {
			origin: redirectUrl,
			base: redirectUrl,
		};
		const newSiteDirective = await getSiteDirective(
			redirectMeta,
			url,
			bareClient
		);
		await getMostRestrictiveSite(redirectUrl.toString(), newSiteDirective);

		// ensure that ?type=module is not lost in a redirect
		if (scriptType) {
			responseHeaders["location"] = appendUrlParams(
				responseHeaders["location"],
				{ type: scriptType }
			);
		}
	}

	for (const cookie of setCookies) {
		// Only window realms install the synchronous document-cookie listener.
		// Waiting for an acknowledgement from a worker client would never resolve.
		if (client?.type === "window") {
			const promise = swtarget.dispatch(client, {
				sherpa$type: "cookie",
				cookie,
				url: url.href,
			});
			if (destination !== "document" && destination !== "iframe") {
				// awaited in header order on purpose: a subresource response must
				// not be delivered until each Set-Cookie has been applied to the
				// client's synchronous jar, and later cookies may override earlier
				// ones, so these can't be dispatched in parallel.
				try {
					// eslint-disable-next-line no-await-in-loop
					await promise;
				} catch (error) {
					console.warn(
						"failed to synchronize a Set-Cookie with the client",
						error
					);
				}
			} else {
				void promise.catch((error) => {
					console.warn(
						"failed to synchronize a Set-Cookie with the client",
						error
					);
				});
			}
		}
	}

	await cookieStore.setCookies(setCookies, url);
	if (setCookies.length) {
		const db = await getDB();
		await db.put("cookies", JSON.parse(cookieStore.dump()), "cookies");
	}

	if (isDownload(responseHeaders, destination) && !isRedirectResponse) {
		if (flagEnabled("interceptDownloads", url)) {
			if (!client) {
				throw new Error("cant find client");
			}
			let filename: string | null = null;
			const disp = responseHeaders["content-disposition"];
			if (typeof disp === "string") {
				const filenameMatch = disp.match(/filename=["']?([^"';\n]*)["']?/i);
				if (filenameMatch && filenameMatch[1]) {
					filename = filenameMatch[1];
				}
			}
			const length = responseHeaders["content-length"];

			// there's no reliable way of finding the top level client that made the request
			// just take the first one and hope
			let clis = await clients.matchAll({});
			// only want controller windows
			clis = clis.filter((e) => !e.url.includes(config.prefix));
			if (clis.length < 1) {
				throw Error(
					"couldn't find a controller client to dispatch download to"
				);
			}

			const download: SherpaDownload = {
				filename,
				url: url.href,
				type: responseHeaders["content-type"] ?? "application/octet-stream",
				body: response.body,
				length: Number(length),
			};
			clis[0].postMessage(
				{
					sherpa$type: "download",
					download,
				} as MessageW2C,
				response.body ? [response.body] : []
			);

			// A 204 navigation leaves the current document in place while allowing
			// this FetchEvent to settle after the body stream has been transferred.
			return new Response(null, { status: 204 });
		} else {
			// manually rewrite for regular browser download
			const header = responseHeaders["content-disposition"] ?? "";

			// validate header and test for filename
			if (!/\s*?((inline|attachment);\s*?)filename=/i.test(header)) {
				// if filename= wasn"t specified then maybe the remote specified to download this as an attachment?
				// if it"s invalid then we can still possibly test for the attachment/inline type
				const type = /^\s*?attachment/i.test(header) ? "attachment" : "inline";

				// set the filename
				const [filename] = new URL(response.finalURL).pathname
					.split("/")
					.slice(-1);

				responseHeaders["content-disposition"] =
					`${type}; filename=${JSON.stringify(filename)}`;
			}
		}
	}

	if (response.body && !isRedirectResponse) {
		responseBody = await rewriteBody(
			response,
			meta,
			destination,
			scriptType,
			cookieStore,
			responseHeaders
		);
		if (responseBody !== response.body)
			delete responseHeaders["content-length"];
	}

	if (responseHeaders["accept"] === "text/event-stream") {
		responseHeaders["content-type"] = "text/event-stream";
	}

	// sherpa runtime can use features that permissions-policy blocks
	delete responseHeaders["permissions-policy"];

	if (
		crossOriginIsolated &&
		[
			"document",
			"iframe",
			"worker",
			"sharedworker",
			"style",
			"script",
		].includes(destination)
	) {
		responseHeaders["Cross-Origin-Embedder-Policy"] = "require-corp";
		responseHeaders["Cross-Origin-Opener-Policy"] = "same-origin";
	}

	const ev = new SherpaHandleResponseEvent(
		responseBody,
		responseHeaders,
		response.status,
		response.statusText,
		destination,
		url,
		response,
		client
	);
	swtarget.dispatchEvent(ev);

	// Clean up tracker if not a redirect
	if (!isRedirectResponse) {
		await cleanTracker(url.toString());
	}

	return new Response(ev.responseBody, {
		headers: ev.responseHeaders as HeadersInit,
		status: ev.status,
		statusText: ev.statusText,
	});
}

// Per the HTML spec's encoding-sniffing algorithm: an explicit HTTP
// charset wins, then a BOM, then a <meta charset> declaration sniffed from
// the first 1024 bytes (decoded as windows-1252, which never throws since
// every byte maps to some character - this matches how browsers prescan).
const headerCharsetRegex = /charset=["']?([\w-]+)/i;
const metaCharsetRegex = /<meta[^>]+charset=["']?([\w-]+)/i;
const prescanDecoder = new TextDecoder("windows-1252");
const utf8Decoder = new TextDecoder("utf-8");
const decodersByCharset = new Map<string, TextDecoder>();

function detectHtmlCharset(
	buf: ArrayBuffer,
	contentTypeHeader: string | null
): string {
	const headerCharset = contentTypeHeader?.match(headerCharsetRegex)?.[1];
	if (headerCharset) return headerCharset.toLowerCase();

	const bytes = new Uint8Array(buf);
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
		return "utf-8";
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

	const prefix = prescanDecoder.decode(
		bytes.subarray(0, Math.min(1024, bytes.length))
	);
	const metaCharset = prefix.match(metaCharsetRegex)?.[1];
	if (metaCharset) return metaCharset.toLowerCase();

	return "utf-8";
}

function decodeWithCharset(buf: ArrayBuffer, charset: string): string {
	let decoder = decodersByCharset.get(charset);
	if (!decoder) {
		try {
			decoder = new TextDecoder(charset);
		} catch {
			// unrecognized/unsupported charset label - fall back rather than
			// throwing and breaking the page entirely
			decoder = utf8Decoder;
		}
		// charset labels seen by one worker form a tiny set, but cap it anyway
		if (decodersByCharset.size < 64) decodersByCharset.set(charset, decoder);
	}

	return decoder.decode(buf);
}

async function rewriteBody(
	response: BareResponseFetch,
	meta: URLMeta,
	destination: RequestDestination,
	workertype: string,
	cookieStore: CookieStore,
	responseHeaders: Record<string, string>
): Promise<BodyType> {
	switch (destination) {
		case "iframe":
		case "document":
			if (isHtmlContentType(response.headers.get("content-type"))) {
				const buf = await response.arrayBuffer();
				const charset = detectHtmlCharset(
					buf,
					response.headers.get("content-type")
				);
				const htmlContent = decodeWithCharset(buf, charset);

				// The rewritten body always goes back out as a UTF-8-encoded
				// string regardless of the upstream charset, so the outgoing
				// header must say so - an explicit HTTP charset takes priority
				// over any now-stale in-document <meta charset> declaration,
				// so this alone is enough to stop the browser re-mojibake-ing it.
				responseHeaders["content-type"] = normalizeHtmlContentType(
					responseHeaders["content-type"]
				);

				return rewriteHtml(htmlContent, cookieStore, meta, true);
			} else {
				return response.body;
			}
		case "script": {
			return rewriteJs(
				new Uint8Array(await response.arrayBuffer()),
				response.finalURL,
				meta,
				workertype === "module"
			) as unknown as ArrayBuffer;
		}
		case "style":
			return rewriteCss(await response.text(), meta);
		case "sharedworker":
		case "worker":
			return rewriteWorkers(
				new Uint8Array(await response.arrayBuffer()),
				workertype,
				response.finalURL,
				meta
			);
		default:
			return response.body;
	}
}

type BodyType = string | ArrayBuffer | Blob | ReadableStream<any>;

export class SherpaHandleResponseEvent extends Event {
	constructor(
		public responseBody: BodyType,
		public responseHeaders: Record<string, string>,
		public status: number,
		public statusText: string,
		public destination: string,
		public url: URL,
		public rawResponse: BareResponseFetch,
		public client: Client
	) {
		super("handleResponse");
	}
}

export class SherpaRequestEvent extends Event {
	constructor(
		public url: URL,
		public requestHeaders: Record<string, string>,
		public body: BodyType,
		public method: string,
		public destination: string,
		public client: Client
	) {
		super("request");
	}
	public response?: BareResponseFetch | Promise<BareResponseFetch>;
}
