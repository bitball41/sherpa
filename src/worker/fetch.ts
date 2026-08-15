import BareClient, { BareResponseFetch } from "@mercuryworkshop/bare-mux";
import { MessageW2C, SherpaServiceWorker } from "@/worker";
import { renderError } from "@/worker/error";
import { couldShareCookies, CookieStore } from "@/shared/cookie";

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

import {
	rewriteUrl,
	snapshotMeta,
	unrewriteBlob,
	unrewriteUrl,
	type URLMeta,
} from "@rewriters/url";
import { rewriteJs } from "@rewriters/js";
import { flattenResponseHeaders, SherpaHeaders } from "@/shared/headers";
import { config, flagEnabled } from "@/shared";
import { rewriteHeaders } from "@rewriters/headers";
import { rewriteHtmlResponse } from "@/worker/htmlStream";
import { rewriteCss } from "@rewriters/css";
import { rewriteManifest } from "@rewriters/manifest";
import { rewriteWorkers } from "@rewriters/worker";
import { getWasmBytes, asyncSetWasm } from "@rewriters/wasm";
import { SherpaDownload } from "@client/events";
import {
	createOriginHeader,
	createRefererHeader,
	createVirtualRequestContext,
	shouldSendCookies,
} from "@/worker/request";
import { retryTransientHttp2Request } from "@/worker/retry";
import { persistCookieStore } from "@/worker/cookiePersistence";
import {
	isHtmlContentType,
	isRedirectStatus,
	isSniffableHtmlContentType,
	normalizeHtmlContentType,
} from "@/worker/response";
import { appendUrlParamEntries } from "@/shared/urlCodec";
import { INTERNAL_PARAMS, takeInternalParams } from "@/shared/internalParams";
import {
	engineBootPathname,
	engineErrorPathname,
	parseHttpUrl,
	pickBootDocumentUrl,
	renderBootScript,
} from "@/shared/bootScripts";
import {
	canStoreResponseFor,
	canUseStoredResponse,
	responseCachePolicy,
} from "@/shared/httpCache";
import {
	cacheKeyUrl,
	lookupCachedResponse,
	refreshCachedResponse,
	storeCachedResponse,
	type CachedEntry,
} from "@/worker/cache";

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

const WASM_FILE_HEADERS = {
	"content-type": "application/wasm",
	"cache-control": "public, max-age=31536000, immutable",
	"cross-origin-resource-policy": "same-origin",
};

let wasmFileProto: Response | null = null;
let wasmFileProtoBytes: Uint8Array | null = null;

function wasmFileResponse(bytes: Uint8Array): Response {
	if (wasmFileProto && wasmFileProtoBytes === bytes) return wasmFileProto.clone();
	wasmFileProtoBytes = bytes;
	wasmFileProto = new Response(bytes.slice(), { headers: WASM_FILE_HEADERS });

	return wasmFileProto.clone();
}

function decodeTrustedDocumentUrl(
	value: string | undefined | null
): URL | null {
	if (!value || value === "about:client") return null;
	try {
		return parseHttpUrl(unrewriteUrl(value));
	} catch {
		return null;
	}
}

function bootDocumentUrl(
	requestUrl: URL,
	referrer: string,
	clientHref?: string
): URL | null {
	return pickBootDocumentUrl(
		parseHttpUrl(requestUrl.searchParams.get(INTERNAL_PARAMS.url)),
		decodeTrustedDocumentUrl(referrer),
		decodeTrustedDocumentUrl(clientHref)
	);
}

// Destinations that render a document, and the destinations that must carry
// COOP/COEP when the page is cross-origin isolated. Hoisted out of the
// request path: these were array literals rebuilt (and linearly scanned) for
// every single proxied response.
const DOCUMENT_DESTINATIONS = new Set(["document", "iframe"]);
const ISOLATED_DESTINATIONS = new Set([
	"document",
	"iframe",
	"worker",
	"sharedworker",
	"style",
	"script",
]);

// displayable mime types, checked as a download fallback
const displayableMimes = new Set([
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
]);

function isDownload(responseHeaders: object, destination: string): boolean {
	if (DOCUMENT_DESTINATIONS.has(destination)) {
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
				!displayableMimes.has(contentType) &&
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
		const requestUrl = new URL(request.url);

		if (requestUrl.pathname === this.config.files.wasm) {
			// Serve the rewriter as `application/wasm` from the copy the worker
			// already loaded. Embedding it as a 695 KiB base64 classic script
			// forced every document (and every iframe) to parse that JS on the
			// main thread; a binary fetch overlaps the runtime download instead.
			let bytes = getWasmBytes();
			if (!bytes) {
				await asyncSetWasm();
				bytes = getWasmBytes();
			}
			if (!bytes) {
				throw new Error("rewriter wasm not loaded");
			}

			return wasmFileResponse(bytes);
		}

		// Error-page preview. Navigating to `${prefix}$error` renders the themed
		// error page with a representative sample trace, so developers can preview
		// their `errorPage` customization without triggering a real fetch failure.
		// `SherpaController.errorPreviewUrl` returns this URL.
		if (requestUrl.pathname === engineErrorPathname(this.config.prefix)) {
			const sampleTrace = [
				"Message: Failed to fetch",
				"Url: https://example.com/",
				"Destination: document",
				"Stack: TypeError: Failed to fetch\n    at Sherpa error-page preview",
			].join("\n\n");

			return renderError(sampleTrace, "https://example.com/");
		}

		// Per-document boot script: a fresh cookie dump plus `loadAndHook`.
		// Kept off the document HTML so rewritten documents can be cached
		// without freezing a session into the replayed markup.
		if (requestUrl.pathname === engineBootPathname(this.config.prefix)) {
			const documentUrl = bootDocumentUrl(
				requestUrl,
				request.referrer,
				client?.url
			);
			const dump = documentUrl
				? this.cookieStore.dumpForDocument(documentUrl)
				: "{}";

			return new Response(renderBootScript(dump), {
				headers: {
					"content-type": "text/javascript; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}

		// Only parameters under Sherpa's own namespace are hints for the engine.
		// Everything else belongs to the site - a GET form's fields, a link's
		// query string - and has to survive onto the upstream request instead
		// of being swallowed here.
		const {
			scriptType,
			topFrameName,
			parentFrameName,
			fromServiceWorkerRuntime,
			siteParams,
		} = takeInternalParams(requestUrl);

		const url = new URL(unrewriteUrl(requestUrl));
		// Now that we're past unrewriting it's safe to put the site's own
		// parameters back.
		//
		// They *replace* the decoded URL's query rather than being appended to
		// it. Every query Sherpa itself puts on a proxied URL lives under the
		// `sherpa.` namespace and was taken off above, so a parameter that
		// isn't one of ours can only have come from the one thing that appends
		// a query to an existing URL without going through `rewriteUrl`: a GET
		// form submission, which per HTML *sets* the action URL's query. A
		// search box on a page whose own URL already carried `?q=` used to
		// submit `?q=old&q=new` upstream, and every framework reads the first
		// one - so the search silently did nothing.
		if (siteParams.length) {
			url.search = "";
			appendUrlParamEntries(url, siteParams);
		}

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
					ISOLATED_DESTINATIONS.has(request.destination)
				) {
					r.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
					r.headers.set("Cross-Origin-Opener-Policy", "same-origin");
				}

				return r;
			}
		}
		if (url.origin === requestUrl.origin) {
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

		// Rewritten-response cache. A service worker's synthesized responses are
		// never stored in the browser's HTTP cache and the transport has none of
		// its own, so without this every navigation re-downloads and re-rewrites
		// every subresource a page touches, forever, whatever `Cache-Control` the
		// origin sent. The lookup runs *after* the `request` event so a listener
		// that overrides or redirects a request still sees every one of them.
		const now = Date.now();
		let cacheKey: string | null = null;
		let cachedEntry: CachedEntry | null = null;
		if (
			!ev.response &&
			flagEnabled("responseCache", ev.url) &&
			canStoreResponseFor(ev.method, request.destination, request.headers)
		) {
			cacheKey = cacheKeyUrl(ev.url, request.destination, scriptType, (name) =>
				name === "origin" ? (origin ?? null) : request.headers.get(name)
			);

			if (canUseStoredResponse(request.cache, request.headers)) {
				cachedEntry = await lookupCachedResponse(cacheKey, now);
				if (cachedEntry?.fresh) {
					// The redirect tracker was opened for a request that is now
					// never going out; leaving it behind would pin an entry until
					// its hour-long expiry.
					await cleanTracker(url.toString());

					return cachedEntry.response;
				}

				// Stale but revalidatable: a 304 below reuses the stored rewrite
				// instead of paying for the download and the rewrite again.
				if (cachedEntry?.etag)
					ev.requestHeaders["if-none-match"] = cachedEntry.etag;
				else if (cachedEntry?.lastModified)
					ev.requestHeaders["if-modified-since"] = cachedEntry.lastModified;
			}
		}

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

		// Revalidated: upstream confirmed the stored rewrite is still current, so
		// neither the body nor the rewriter has to run again.
		if (cachedEntry && cacheKey && response.status === 304) {
			await cleanTracker(url.toString());

			return await refreshCachedResponse(
				cacheKey,
				cachedEntry,
				lowercaseHeaderRecord(response.rawHeaders),
				now,
				request.destination
			);
		}

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
			requestContext.referrerUrl?.href || "",
			requestContext.clientUrl,
			cacheKey,
			now
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

		if (!DOCUMENT_DESTINATIONS.has(request.destination))
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
	referrer: string,
	clientUrl: URL | null = null,
	cacheKey: string | null = null,
	now: number = Date.now()
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
		mode === "navigate" && DOCUMENT_DESTINATIONS.has(destination);
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
		try {
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

			// ensure the module hint is not lost in a redirect
			if (scriptType) {
				const loc = new URL(responseHeaders["location"]);
				loc.searchParams.set(INTERNAL_PARAMS.type, scriptType);
				responseHeaders["location"] = loc.href;
			}
		} catch (error) {
			// A malformed Location must not turn the redirect into an error page;
			// the browser will fail the navigation on its own.
			console.warn("Sherpa: ignoring an unparseable redirect Location", error);
		}
	}

	// Only window realms install the synchronous document-cookie listener
	// (waiting on an acknowledgement from a worker client would never resolve),
	// and only a cookie the client's own `document.cookie` could ever return is
	// worth sending: a page's cross-site subresource responses used to have
	// their `Set-Cookie` pushed into that page's realm, which both put another
	// site's cookies where they did not belong and made every one of those
	// responses wait on a round trip to the page for a jar it can never read.
	const syncCookiesToClient =
		client?.type === "window" &&
		(!clientUrl || couldShareCookies(clientUrl.hostname, url.hostname));

	if (syncCookiesToClient) {
		for (const cookie of setCookies) {
			const promise = swtarget.dispatch(client, {
				sherpa$type: "cookie",
				cookie,
				url: url.href,
			});
			if (!DOCUMENT_DESTINATIONS.has(destination)) {
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
	// Not awaited: the in-memory jar is already current, and every later read
	// goes through it. Blocking the response on a storage round trip only
	// bought durability against a service-worker restart in the next few
	// milliseconds.
	if (setCookies.length) void persistCookieStore(cookieStore);

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

	// (An `Accept: text/event-stream` check used to live here, reading a
	// *request* header name out of the response headers - so it never once
	// fired. Nothing needs it: the upstream `Content-Type` survives
	// `rewriteHeaders`, and an event stream's body is passed through
	// unbuffered by `rewriteBody`'s default case.)

	// sherpa runtime can use features that permissions-policy blocks
	delete responseHeaders["permissions-policy"];

	if (crossOriginIsolated && ISOLATED_DESTINATIONS.has(destination)) {
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

	// The policy runs against the *unflattened* rewritten headers: flattening
	// drops `Set-Cookie` (it is consumed by the jar and never exposed to the
	// page), and a response that sets cookies must not be replayed from cache.
	const storePolicy = cacheKey
		? responseCachePolicy(ev.status, rewrittenHeaders, now, destination)
		: null;

	const finalResponse = new Response(ev.responseBody, {
		headers: ev.responseHeaders as HeadersInit,
		status: ev.status,
		statusText: ev.statusText,
	});

	// Cloning tees a streamed body, so it only happens once the policy has
	// already said yes - `storeCachedResponse` always drains its branch.
	if (storePolicy && cacheKey) {
		void storeCachedResponse(cacheKey, storePolicy, finalResponse.clone(), now);
	}

	return finalResponse;
}

/** Response headers, keyed the way {@link responseCachePolicy} expects. */
function lowercaseHeaderRecord(
	headers: Record<string, string | string[]>
): Record<string, string | string[]> {
	const record: Record<string, string | string[]> = Object.create(null);
	for (const key of Object.keys(headers)) {
		record[key.toLowerCase()] = headers[key];
	}

	return record;
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
		case "document": {
			const contentType = response.headers.get("content-type");
			if (
				isHtmlContentType(contentType) ||
				isSniffableHtmlContentType(contentType)
			) {
				const rewritten = await rewriteHtmlResponse(
					response.body,
					contentType,
					cookieStore,
					meta,
					!isHtmlContentType(contentType)
				);
				if (rewritten.rewrote) {
					// The rewritten body always goes back out as UTF-8 regardless of
					// the upstream charset, so the outgoing header must say so - an
					// explicit HTTP charset takes priority over any now-stale
					// in-document <meta charset> declaration, so this alone is
					// enough to stop the browser re-mojibake-ing it.
					responseHeaders["content-type"] = normalizeHtmlContentType(
						responseHeaders["content-type"]
					);
				}

				const body = rewritten.body;
				if (body instanceof Uint8Array) {
					const copy = new Uint8Array(body.byteLength);
					copy.set(body);

					return copy.buffer;
				}

				return body;
			}

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
		case "manifest": {
			// The manifest's own URL is the base every relative member resolves
			// against, and it can't change while the document is being read, so
			// resolve the meta once for the whole file.
			const resolved = snapshotMeta(meta);

			return rewriteManifest(await response.text(), (url) =>
				rewriteUrl(url, resolved)
			);
		}
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
