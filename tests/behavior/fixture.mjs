// The fixture site the behavior suite proxies. Every URL is relative, so
// everything resolves back through the proxy to this local origin.
//
// The page runs its own assertions in inline scripts (which the service worker
// rewrites, so they exercise the real client traps as a page would) and leaves
// the results on `window.__sherpaResults` for the driver to read.

const CHECKS = String.raw`
const results = [];
window.__sherpaResults = results;
function check(name, fn) {
	try {
		const detail = fn();
		results.push({ name, ok: true, detail: detail === undefined ? null : detail });
	} catch (error) {
		results.push({ name, ok: false, detail: String(error && error.message || error) });
	}
}
function eq(actual, expected, what) {
	if (actual !== expected)
		throw new Error((what || "value") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
	return actual;
}

// ---------------------------------------------------------------- selectors
check("querySelector matches a prefix on an authored href", () => {
	const found = document.querySelectorAll('a[href^="/docs/"]');
	eq(found.length, 2, "count");
	return Array.from(found, (a) => a.getAttribute("href")).join(",");
});

check("querySelector matches an exact authored href", () => {
	const a = document.querySelector('a[href="/docs/intro.html"]');
	if (!a) throw new Error("no match");
	return eq(a.id, "intro", "id");
});

check("querySelector matches a suffix on an authored src", () => {
	return eq(document.querySelectorAll('img[src$="-a.png"]').length, 1, "count");
});

check("element.querySelectorAll is loosened too", () => {
	const scope = document.getElementById("scope");
	return eq(scope.querySelectorAll('a[href^="/docs/"]').length, 1, "count");
});

check("matches() and closest() see authored values", () => {
	const a = document.getElementById("intro");
	if (!a.matches('a[href^="/docs/"]')) throw new Error("matches() failed");
	const li = a.closest('li');
	if (!li) throw new Error("closest(li) failed");
	if (!document.getElementById("scope").querySelector('a[href^="/docs/"]'))
		throw new Error("scoped querySelector failed");
	return "ok";
});

check("selectors on attributes sherpa never rewrites still work", () => {
	eq(document.querySelectorAll('[data-kind="widget"]').length, 1, "data");
	return eq(document.querySelectorAll('input[type="text"]').length, 1, "type");
});

check("a selector list rewrites every member", () => {
	return eq(
		document.querySelectorAll('a[href^="/docs/"], img[src$="-b.png"]').length,
		4,
		"count"
	);
});

// --------------------------------------------------------------- attributes
check("element.attributes hides sherpa's shadow attributes", () => {
	const a = document.getElementById("intro");
	const names = [];
	for (let i = 0; i < a.attributes.length; i++) names.push(a.attributes[i].name);
	if (names.some((n) => n.startsWith("sherpa-attr-")))
		throw new Error("shadow attribute visible: " + names.join(","));
	if (names.indexOf("href") === -1) throw new Error("href missing: " + names.join(","));
	if (names.indexOf("id") === -1) throw new Error("id missing: " + names.join(","));
	// indices must be dense: no undefined holes where a shadow attribute sat
	if (names.some((n) => n === undefined)) throw new Error("hole in indices");
	return eq(names.length, a.attributes.length, "length agrees with iteration");
});

check("spreading element.attributes agrees with its length", () => {
	const a = document.getElementById("intro");
	const spread = Array.from(a.attributes);
	if (spread.some((attr) => !attr || attr.name.startsWith("sherpa-attr-")))
		throw new Error("shadow attribute leaked into iteration");
	return eq(spread.length, a.attributes.length, "spread length");
});

check("getAttribute returns the authored value", () => {
	return eq(document.getElementById("intro").getAttribute("href"), "/docs/intro.html", "href");
});

// -------------------------------------------------------------------- events
check("window.event tracks the event being dispatched", () => {
	const target = document.getElementById("scope");
	const seen = [];
	const first = () => seen.push(window.event && window.event.type);
	target.addEventListener("ping", first);
	target.dispatchEvent(new Event("ping"));
	target.dispatchEvent(new Event("ping"));
	target.removeEventListener("ping", first);

	const other = () => seen.push(window.event && window.event.type);
	target.addEventListener("pong", other);
	target.dispatchEvent(new Event("pong"));
	target.removeEventListener("pong", other);

	eq(seen.join(","), "ping,ping,pong", "sequence");
	// and it must not stay pinned once dispatch is over
	return eq(window.event === undefined || window.event === null, true, "cleared after dispatch");
});

check("removeEventListener still unregisters through the trap", () => {
	const target = document.getElementById("scope");
	let calls = 0;
	const fn = () => calls++;
	target.addEventListener("tick", fn);
	target.dispatchEvent(new Event("tick"));
	target.removeEventListener("tick", fn);
	target.dispatchEvent(new Event("tick"));
	return eq(calls, 1, "calls");
});

check("duplicate registrations are collapsed like the DOM does", () => {
	const target = document.getElementById("scope");
	let calls = 0;
	const fn = () => calls++;
	target.addEventListener("dup", fn);
	target.addEventListener("dup", fn);
	target.dispatchEvent(new Event("dup"));
	target.removeEventListener("dup", fn);
	target.dispatchEvent(new Event("dup"));
	return eq(calls, 1, "calls");
});

check("capture and bubble registrations are independent", () => {
	const target = document.getElementById("scope");
	let calls = 0;
	const fn = () => calls++;
	target.addEventListener("cap", fn, true);
	target.addEventListener("cap", fn, false);
	target.dispatchEvent(new Event("cap"));
	target.removeEventListener("cap", fn, true);
	target.dispatchEvent(new Event("cap"));
	target.removeEventListener("cap", fn, false);
	return eq(calls, 3, "calls");
});

check("once listeners fire exactly once", () => {
	const target = document.getElementById("scope");
	let calls = 0;
	target.addEventListener("solo", () => calls++, { once: true });
	target.dispatchEvent(new Event("solo"));
	target.dispatchEvent(new Event("solo"));
	return eq(calls, 1, "calls");
});

check("handleEvent objects still work", () => {
	const target = document.getElementById("scope");
	let calls = 0;
	const listener = { handleEvent() { calls++; } };
	target.addEventListener("obj", listener);
	target.dispatchEvent(new Event("obj"));
	target.removeEventListener("obj", listener);
	target.dispatchEvent(new Event("obj"));
	return eq(calls, 1, "calls");
});

// ------------------------------------------------------------------- wrapfn
check("eval keeps its identity through the wrap function", () => {
	return eq(eval === eval, true, "eval === eval");
});

check("wrapped identifiers still resolve to the proxied location", () => {
	if (typeof location.href !== "string") throw new Error("no location.href");
	if (location.href.indexOf("/proxied/") !== -1)
		throw new Error("location leaked the proxy URL: " + location.href);
	eq(new URL(location.href).origin, "http://127.0.0.1:4720", "origin");
	return location.pathname;
});

check("top and parent stay inside the proxy context", () => {
	if (typeof top !== "object" || top === null) throw new Error("no top");
	if (typeof parent !== "object" || parent === null) throw new Error("no parent");
	return "ok";
});

check("primitives pass through the wrap function untouched", () => {
	// exercises the fast path: these are all rewritten as wrapped identifiers
	const loc = "location", par = 5, t = null, ev = undefined;
	eq(loc, "location", "string");
	eq(par, 5, "number");
	eq(t, null, "null");
	return eq(ev, undefined, "undefined");
});

// -------------------------------------------------------------- inline html
check("a non-ascii inline script round-trips through innerHTML", () => {
	const holder = document.getElementById("scripts");
	const html = holder.innerHTML;
	if (html.indexOf("café – 日本語 🏔") === -1)
		throw new Error("mojibake or missing source: " + html.slice(0, 200));
	return "ok";
});

check("a non-ascii inline script's textContent round-trips", () => {
	const script = document.getElementById("unicode-script");
	if (script.textContent.indexOf("café – 日本語 🏔") === -1)
		throw new Error("mojibake: " + script.textContent.slice(0, 200));
	return "ok";
});

check("the inline script actually executed with its unicode intact", () => {
	return eq(window.__unicodeValue, "café – 日本語 🏔", "value");
});

// -------------------------------------------------------------------- base
check("a <base href> still resolves relative urls", () => {
	const a = document.getElementById("based");
	// authored value is preserved for the page
	eq(a.getAttribute("href"), "relative.html", "authored");
	// and the resolved property resolves against <base>, not the document
	return eq(a.href, "http://127.0.0.1:4720/base-root/relative.html", "resolved");
});

check("document.baseURI reports the real base, not the proxy origin", () => {
	if (document.baseURI.indexOf("4721") !== -1 || document.baseURI.indexOf("/proxied/") !== -1)
		throw new Error("proxy origin leaked: " + document.baseURI);
	return eq(document.baseURI, "http://127.0.0.1:4720/base-root/", "baseURI");
});
`;

const ASYNC_CHECKS = String.raw`
(async () => {
	const results = window.__sherpaResults;
	async function check(name, fn) {
		try {
			const detail = await fn();
			results.push({ name, ok: true, detail: detail === undefined ? null : detail });
		} catch (error) {
			results.push({ name, ok: false, detail: String(error && error.message || error) });
		}
	}

	await check("fetch() rewrites a plain string url", async () => {
		const res = await fetch("/api/echo");
		if (!res.ok) throw new Error("status " + res.status);
		const body = await res.text();
		if (body !== "echo") throw new Error("body: " + body);
		return "ok";
	});

	await check("fetch() rewrites a url-like object", async () => {
		// An <a> element is a perfectly good RequestInfo: WebIDL stringifies it.
		// Before the fix this reached the network as the site's real URL and
		// never came back through the proxy at all.
		const a = document.createElement("a");
		a.href = "/api/echo";
		const res = await fetch(a);
		if (!res.ok) throw new Error("status " + res.status);
		return "ok";
	});

	await check("new Request() rewrites a url-like object", async () => {
		const a = document.createElement("a");
		a.href = "/api/echo";
		const req = new Request(a);
		if (req.url.indexOf("/api/echo") === -1)
			throw new Error("request url: " + req.url);
		const res = await fetch(req);
		if (!res.ok) throw new Error("status " + res.status);
		return "ok";
	});

	await check("fetch(Request) is passed through unchanged", async () => {
		const req = new Request("/api/echo");
		const res = await fetch(req);
		if (!res.ok) throw new Error("status " + res.status);
		return "ok";
	});

	await check("changing the <base href> moves url resolution", async () => {
		// The resolved base is memoized per (href, document url); this is what
		// proves the memo actually invalidates.
		const base = document.getElementsByTagName("base")[0];
		base.setAttribute("href", "/late-base/");
		try {
			const a = document.createElement("a");
			a.setAttribute("href", "next.html");
			if (a.href !== "http://127.0.0.1:4720/late-base/next.html")
				throw new Error("resolved to " + a.href);
			return "ok";
		} finally {
			base.setAttribute("href", "/base-root/");
		}
	});

	await check("a <base> inserted earlier in tree order takes over", async () => {
		// The live <base> collection has to see a DOM change made in the same
		// synchronous turn, or a cached lookup would still answer with the old
		// element.
		const base = document.createElement("base");
		base.setAttribute("href", "/first-base/");
		document.head.insertBefore(base, document.head.firstChild);
		try {
			const a = document.createElement("a");
			a.setAttribute("href", "next.html");
			if (a.href !== "http://127.0.0.1:4720/first-base/next.html")
				throw new Error("resolved to " + a.href);
			return "ok";
		} finally {
			base.remove();
		}
	});

	await check("removing that <base> restores the original resolution", async () => {
		const a = document.createElement("a");
		a.setAttribute("href", "sibling.html");
		if (a.href !== "http://127.0.0.1:4720/base-root/sibling.html")
			throw new Error("resolved to " + a.href);
		return "ok";
	});

	window.__sherpaDone = true;
})();
`;

export const pages = {
	"/index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="/base-root/">
<title>sherpa behavior fixture</title>
</head>
<body>
<ul>
	<li><a id="intro" href="/docs/intro.html" data-kind="link">Intro</a></li>
	<li><a href="/blog/post.html">Blog</a></li>
</ul>
<div id="scope">
	<a href="/docs/deep.html">Deep</a>
	<span data-kind="widget">widget</span>
	<input type="text" name="q">
</div>
<img src="/img/pixel-a.png" alt="a">
<img src="/img/pixel-b.png" alt="b">
<img src="/img/other-b.png" alt="c">
<a id="based" href="relative.html">relative</a>
<div id="scripts"><script id="unicode-script">window.__unicodeValue = "café – 日本語 🏔";</script></div>
<script>${CHECKS}</script>
<script>${ASYNC_CHECKS}</script>
</body>
</html>`,
};

export const textRoutes = {
	"/api/echo": { body: "echo", type: "text/plain" },
};

/** 1x1 transparent PNG, so the fixture's images are real responses. */
export const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64"
);
