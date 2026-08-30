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
/** First url() target in a css rule, as the page sees it (i.e. unrewritten). */
function cssUrl(cssText) {
	const m = /url\(\s*['"]?([^'")]+)/.exec(cssText);
	if (!m) throw new Error("no url() in: " + cssText);
	return m[1];
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

check("an unparseable rewrite falls back to the page's own selector", () => {
	// The rewriter turns an attribute selector into :is(shadow, real). If a
	// selector ever rewrote into something the CSS parser rejects, throwing a
	// SyntaxError out of querySelector would take the page down; these are the
	// awkward shapes that would find such a bug, and all of them must behave
	// exactly as an unproxied browser would.
	eq(document.querySelectorAll('a[href^="/docs/"]:not([href$="deep.html"])').length, 1, "not()");
	eq(document.querySelectorAll('[href][id]').length, 2, "two attribute selectors");
	eq(document.querySelectorAll('a[href][data-kind="link"]').length, 1, "mixed shadowed/plain");
	eq(document.querySelectorAll('img[src][alt="a"]').length, 1, "img");
	return "ok";
});

check("selectors still work when queried repeatedly (cache path)", () => {
	let n = 0;
	for (let i = 0; i < 5; i++) n += document.querySelectorAll('a[href^="/docs/"]').length;
	return eq(n, 10, "repeat count");
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
	if (names.some((n) => n.startsWith("scramjet-attr-")))
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
	if (spread.some((attr) => !attr || attr.name.startsWith("scramjet-attr-")))
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

// ------------------------------------------------------------- shadow dom
// 'innerHTML' is not one property: 'Element' and 'ShadowRoot' each implement
// the 'InnerHTML' mixin separately, so trapping only 'Element''s left every
// web component writing markup straight past the rewriter.
function shadowHost(html) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = host.attachShadow({ mode: "open" });
	root.innerHTML = html;
	return root;
}

check("shadowRoot.innerHTML rewrites a subresource url", () => {
	const root = shadowHost('<img id="si" src="/img/pixel-a.png">');
	// the reflected property unrewrites, so a rewritten src reads back as the
	// site's own absolute url; an un-rewritten one resolves against the proxy
	return eq(root.getElementById("si").src, "http://127.0.0.1:4720/img/pixel-a.png", "src");
});

check("shadowRoot.innerHTML rewrites a <style> url()", () => {
	const root = shadowHost('<style>#s{background:url(/img/pixel-a.png)}</style>');
	return eq(cssUrl(root.styleSheets[0].cssRules[0].cssText), "http://127.0.0.1:4720/img/pixel-a.png", "url()");
});

check("shadowRoot.setHTMLUnsafe rewrites a subresource url", () => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = host.attachShadow({ mode: "open" });
	if (!root.setHTMLUnsafe) return "unsupported";
	root.setHTMLUnsafe('<img id="su" src="/img/pixel-a.png">');
	return eq(root.getElementById("su").src, "http://127.0.0.1:4720/img/pixel-a.png", "src");
});

check("shadowRoot.innerHTML reads back the authored markup", () => {
	const root = shadowHost('<img id="sr" src="/img/pixel-a.png">');
	if (root.innerHTML.indexOf("scramjet-attr-") !== -1)
		throw new Error("shadow attribute leaked: " + root.innerHTML);
	return eq(root.innerHTML.indexOf('src="/img/pixel-a.png"') !== -1, true, "authored src");
});

// ------------------------------------------------------------ <style> text
// A <style> element's text *is* its stylesheet, and every way of writing that
// text has to reach rewriteCss - not just textContent/innerHTML. The paths
// below are the ones CSS-in-JS actually uses.
function styleWith(write) {
	const style = document.createElement("style");
	document.head.appendChild(style);
	write(style);
	return cssUrl(style.sheet.cssRules[0].cssText);
}
const CSS = "#probe{background:url(/img/pixel-a.png)}";
const CSS_RESOLVED = "http://127.0.0.1:4720/img/pixel-a.png";

check("style.appendChild(createTextNode(css)) rewrites url()", () => {
	return eq(styleWith((s) => s.appendChild(document.createTextNode(CSS))), CSS_RESOLVED, "url()");
});

check("style.append(css) rewrites url()", () => {
	return eq(styleWith((s) => s.append(CSS)), CSS_RESOLVED, "url()");
});

check("style.replaceChildren(css) rewrites url()", () => {
	return eq(styleWith((s) => s.replaceChildren(CSS)), CSS_RESOLVED, "url()");
});

check("style.insertBefore(textNode) rewrites url()", () => {
	return eq(
		styleWith((s) => s.insertBefore(document.createTextNode(CSS), null)),
		CSS_RESOLVED,
		"url()"
	);
});

check("style.insertAdjacentText rewrites url()", () => {
	return eq(styleWith((s) => s.insertAdjacentText("beforeend", CSS)), CSS_RESOLVED, "url()");
});

check("writing a style's text node .data rewrites url()", () => {
	return eq(
		styleWith((s) => {
			s.textContent = "#probe{color:red}";
			s.firstChild.data = CSS;
		}),
		CSS_RESOLVED,
		"url()"
	);
});

check("a style's text node reads back the authored css", () => {
	const style = document.createElement("style");
	document.head.appendChild(style);
	style.appendChild(document.createTextNode(CSS));
	// the page must never see the proxied url it never wrote
	if (style.firstChild.data.indexOf("/proxied/") !== -1)
		throw new Error("proxy url leaked: " + style.firstChild.data);
	return eq(style.firstChild.nodeValue.indexOf("/proxied/"), -1, "nodeValue too");
});

check("text nodes outside a <style> are left completely alone", () => {
	const p = document.createElement("p");
	document.body.appendChild(p);
	p.appendChild(document.createTextNode("url(/img/pixel-a.png)"));
	eq(p.firstChild.data, "url(/img/pixel-a.png)", "data");
	p.firstChild.nodeValue = "url(/other.png)";
	return eq(p.textContent, "url(/other.png)", "textContent");
});

check("a rule added inside @media is rewritten too", () => {
	const style = document.createElement("style");
	style.textContent = "@media all{}";
	document.head.appendChild(style);
	style.sheet.cssRules[0].insertRule(CSS, 0);
	return eq(cssUrl(style.sheet.cssRules[0].cssRules[0].cssText), CSS_RESOLVED, "url()");
});

// ----------------------------------------------------------------- svg/legacy
check("<use xlink:href> is rewritten like <use href>", () => {
	// SVG 1.1 spells the reference xlink:href, which is what every icon sprite
	// in the wild uses; only the SVG 2 spelling was being rewritten.
	// no ids on these, so the selector checks above keep counting what they meant to
	const uses = document.getElementsByTagName("use");
	eq(uses[1].href.baseVal, "http://127.0.0.1:4720/sprite.svg#icon", "href");
	return eq(uses[0].href.baseVal, "http://127.0.0.1:4720/sprite.svg#icon", "xlink:href");
});

check("a <style> the browser won't parse as css is left exactly as authored", () => {
	// Per HTML a style element is only a stylesheet when its type is absent,
	// empty or text/css. Anything else is inert markup a library reads for
	// itself - Tailwind's browser build keeps its input in
	// <style type="text/tailwindcss"> - so rewriting it corrupts that library's
	// own source. It must come back byte-for-byte.
	const inert = document.getElementById("inert-style");
	eq(inert.sheet, null, "really inert (no stylesheet)");
	eq(inert.textContent, ".inert{background:url(/img/pixel-a.png)}", "textContent");
	return eq(inert.firstChild.data, ".inert{background:url(/img/pixel-a.png)}", "text node");
});

check("<body background> keeps the value the page authored", () => {
	return eq(document.body.getAttribute("background"), "/img/pixel-a.png", "authored");
});

// ------------------------------------------------------- streamed documents
// A document response is flushed in two parts: its own doctype plus the boot
// scripts as soon as the first ~1 KiB has arrived, then the rewritten
// remainder. The doctype has to survive that split byte-exactly, because it is
// what decides the document's rendering mode, and the parser has to merge the
// <html>/<body> attributes that now arrive after the injected scripts.
check("a streamed document keeps standards mode", () => {
	return eq(document.compatMode, "CSS1Compat", "compatMode");
});

check("<html> and <body> attributes survive the early flush", () => {
	eq(document.documentElement.lang, "en", "html lang");
	return eq(document.body.className, "fixture-body", "body class");
});

check("the boot scripts still come before the page's own", () => {
	// window.__firstInlineRan is set by the first inline script in the document;
	// if the runtime had not hooked by then, the checks in it could not have run
	return eq(window.__firstInlineRan, true, "first inline script ran hooked");
});

// ------------------------------------------------------- proxied event shape
check("onmessage is per instance, not shared across every port", () => {
	// The page's handler used to be stashed on the trap descriptor itself -
	// one slot for every MessagePort in the realm - so reading it back on any
	// other port answered with the last one set anywhere.
	const a = new MessageChannel();
	const b = new MessageChannel();
	const first = () => {};
	const second = () => {};
	a.port1.onmessage = first;
	b.port1.onmessage = second;

	eq(a.port1.onmessage, first, "first port");
	eq(b.port1.onmessage, second, "second port");
	a.port1.onmessage = null;
	eq(a.port1.onmessage, null, "cleared");
	return eq(b.port1.onmessage, second, "the other port is untouched");
});

check("a link stringifies to the site's url, not the proxy's", () => {
	// The stringifier is a separate method from the href getter, so while
	// a.href unrewrote correctly, String(a), a + "" and new URL(a) all
	// handed the page Sherpa's proxied URL. Sites build URLs
	// out of link elements exactly this way.
	const a = document.getElementById("intro");
	eq(String(a), "http://127.0.0.1:4720/docs/intro.html", "String(a)");
	eq(a.toString(), "http://127.0.0.1:4720/docs/intro.html", "a.toString()");
	eq("" + a, "http://127.0.0.1:4720/docs/intro.html", "concatenation form");
	return eq(new URL(String(a)).pathname, "/docs/intro.html", "new URL(a)");
});

check("a computed style reads back the site's url", () => {
	// getComputedStyle(el).backgroundImage is how a site finds out what image
	// an element is showing. Only the *inline* declaration was wrapped, so
	// this read leaked the proxied url - while getPropertyValue, the other
	// spelling of the same read, did not.
	const d = document.createElement("div");
	d.style.backgroundImage = "url(/img/pixel-a.png)";
	document.body.appendChild(d);
	try {
		const computed = getComputedStyle(d);
		eq(cssUrl(computed.backgroundImage), "http://127.0.0.1:4720/img/pixel-a.png", "property access");
		return eq(
			cssUrl(computed.getPropertyValue("background-image")),
			"http://127.0.0.1:4720/img/pixel-a.png",
			"getPropertyValue"
		);
	} finally {
		d.remove();
	}
});

check("element.style keeps its identity across reads", () => {
	const el = document.getElementById("scope");
	eq(el.style === el.style, true, "same declaration wrapper");
	eq(el.style.setProperty === el.style.setProperty, true, "same method");
	el.style.backgroundImage = 'url("/img/pixel-a.png")';
	// the page reads back the site's own url, resolved but never proxied
	return eq(cssUrl(el.style.backgroundImage), "http://127.0.0.1:4720/img/pixel-a.png", "unrewritten for the page");
});

check("storage reflects membership and deletion of its own keys", () => {
	localStorage.setItem("probe", "1");
	eq("probe" in localStorage, true, "in operator sees a stored key");
	eq("never-set" in localStorage, false, "in operator rejects a missing key");
	eq(Object.getOwnPropertyDescriptor(localStorage, "never-set"), undefined, "no phantom descriptor");
	eq(localStorage.getItem === localStorage.getItem, true, "interface member is stable");
	delete localStorage.probe;
	eq(localStorage.getItem("probe"), null, "delete removes it");
	// interface members are not storage keys
	eq(typeof localStorage.length, "number", "length");
	return eq(typeof localStorage.setItem, "function", "setItem");
});

check("<a ping> is rewritten and reads back as authored", () => {
	const a = document.querySelector(".pinged");
	eq(a.getAttribute("ping"), "/beacon/one /beacon/two", "authored value");
	eq(a.ping, "/beacon/one /beacon/two", "reflected value");
	const rewritten = a.outerHTML;
	if (rewritten.indexOf("scramjet-attr-ping") !== -1)
		throw new Error("shadow attribute leaked into markup: " + rewritten);
	return "ok";
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

	await check("a worker's own location carries none of sherpa's hints", async () => {
		// The engine threads 'sherpa.dest'/'sherpa.type' through the query string
		// of the URLs it hands the browser. They are stripped before the upstream
		// request, but they used to survive into what the *page* reads back, so a
		// worker configured by its own search params saw one it never set.
		const worker = new Worker("/worker.js");
		const data = await new Promise((resolveMsg, rejectMsg) => {
			worker.onmessage = (event) => resolveMsg(event.data);
			worker.onerror = (event) => rejectMsg(new Error("worker error: " + event.message));
			setTimeout(() => rejectMsg(new Error("worker timed out")), 10000);
		});
		worker.terminate();
		if (data.href.indexOf("sherpa.") !== -1)
			throw new Error("internal hint leaked into location.href: " + data.href);
		eq(data.search, "", "location.search");
		return eq(data.href, "http://127.0.0.1:4720/worker.js", "location.href");
	});

	await check("document rendering mode survives every doctype shape", async () => {
		// Each of these is a real proxied document (destination "iframe"), so it
		// goes through the same response path as a top-level navigation.
		const cases = [
			["/doc/standards.html", "CSS1Compat", "html5 doctype, streamed"],
			["/doc/quirks.html", "BackCompat", "no doctype at all"],
			["/doc/legacy.html", "CSS1Compat", "html 4.01 strict doctype"],
			["/doc/commented.html", "CSS1Compat", "comment before the doctype"],
			["/doc/tiny.html", "CSS1Compat", "under the flush threshold"],
			["/doc/tiny-quirks.html", "BackCompat", "tiny and doctype-less"],
		];
		const seen = [];
		for (const [path, expected, what] of cases) {
			const frame = document.createElement("iframe");
			document.body.appendChild(frame);
			await new Promise((done, fail) => {
				frame.addEventListener("load", done, { once: true });
				frame.addEventListener("error", fail, { once: true });
				setTimeout(() => fail(new Error("timed out loading " + path)), 15000);
				frame.src = path;
			});
			const doc = frame.contentDocument;
			eq(doc.compatMode, expected, what);
			eq(doc.getElementById("marker").textContent, "marker", what + " body");
			// and the document is still rewritten: its image must resolve to the site
			eq(doc.getElementById("pic").src, "http://127.0.0.1:4720/img/pixel-a.png", what + " img");
			seen.push(what);
			frame.remove();
		}
		return seen.length + " shapes";
	});

	await check("a document served as octet-stream is still rewritten", async () => {
		// Browsers sniff HTML on a navigation when the server omitted a real
		// type or sent application/octet-stream. Sherpa used to pass those
		// through unrewritten, so every relative URL resolved against the
		// proxy origin.
		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		await new Promise((done, fail) => {
			frame.addEventListener("load", done, { once: true });
			setTimeout(() => fail(new Error("sniffed document timed out")), 15000);
			frame.src = "/doc/sniff.html";
		});
		const doc = frame.contentDocument;
		const src = doc.getElementById("pic").src;
		frame.remove();
		return eq(src, "http://127.0.0.1:4720/img/pixel-a.png", "sniffed img");
	});

	await check("a non-utf8 document still decodes correctly", async () => {
		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		await new Promise((done, fail) => {
			frame.addEventListener("load", done, { once: true });
			setTimeout(() => fail(new Error("timed out")), 15000);
			frame.src = "/doc/shiftjis.html";
		});
		const text = frame.contentDocument.getElementById("jp").textContent;
		frame.remove();
		return eq(text, "\u3053\u3093\u306b\u3061\u306f", "shift_jis text");
	});

	await check("an about:blank frame resolves relative urls against its creator", async () => {
		// A frame with no src has no URL to resolve against; per HTML it
		// inherits its creator's base URL. Sherpa resolved against
		// "about:blank", which resolves to nothing, so rewriteUrl handed the
		// markup back untouched and the browser resolved it against the proxy's
		// own origin - which is how every ad slot and every widget that builds
		// its contents with contentDocument.write ends up 404ing.
		const blank = document.createElement("iframe");
		document.body.appendChild(blank);
		const inner = blank.contentDocument;
		inner.body.innerHTML = '<img id="pic" src="/img/pixel-a.png"><a id="link" href="/docs/intro.html">x</a>';
		const src = inner.getElementById("pic").src;
		const href = inner.getElementById("link").href;
		const baseURI = inner.baseURI;
		blank.remove();

		eq(src, "http://127.0.0.1:4720/img/pixel-a.png", "img resolves to the site");
		eq(href, "http://127.0.0.1:4720/docs/intro.html", "anchor resolves to the site");
		// the creator's own <base href> is inherited along with its url
		eq(baseURI, "http://127.0.0.1:4720/base-root/", "baseURI");

		return "ok";
	});

	await check("an <iframe srcdoc> resolves relative urls against its creator", async () => {
		const frame = document.createElement("iframe");
		frame.srcdoc = '<!DOCTYPE html><html><body><img id="pic" src="/img/pixel-a.png"></body></html>';
		document.body.appendChild(frame);
		await new Promise((done, fail) => {
			frame.addEventListener("load", done, { once: true });
			setTimeout(() => fail(new Error("srcdoc frame timed out")), 15000);
		});
		const doc = frame.contentDocument;
		const src = doc.getElementById("pic").src;
		// a url created *after* load, through the traps, has to resolve too
		const late = doc.createElement("img");
		late.setAttribute("src", "/img/pixel-b.png");
		const lateSrc = late.src;
		frame.remove();

		eq(src, "http://127.0.0.1:4720/img/pixel-a.png", "markup url");
		return eq(lateSrc, "http://127.0.0.1:4720/img/pixel-b.png", "url created in the frame");
	});

	await check("the cssom reads back the site's urls, not the proxy's", async () => {
		const link = document.querySelector('link[rel="stylesheet"]');
		const sheet = link.sheet;
		if (!sheet) throw new Error("stylesheet did not load");

		// link.href unrewrites through the reflected property; the stylesheet's
		// own href is a different accessor and handed back the proxied url.
		eq(sheet.href, "http://127.0.0.1:4720/site.css", "sheet.href");
		eq(document.styleSheets[0].href, "http://127.0.0.1:4720/site.css", "styleSheets[i].href");

		// and a rule's declaration is a CSSStyleDeclaration like any other, so
		// reading a url out of it must not leak either
		const rule = sheet.cssRules[0];
		eq(cssUrl(rule.style.backgroundImage), "http://127.0.0.1:4720/img/pixel-a.png", "rule.style");
		return eq(cssUrl(rule.cssText), "http://127.0.0.1:4720/img/pixel-a.png", "rule.cssText");
	});

	await check("currentSrc reports the site's url", async () => {
		const img = document.querySelector('img[alt="a"]');
		// currentSrc is the url the browser actually settled on; it is
		// read-only, so it is not covered by the reflected-property table.
		return eq(img.currentSrc, "http://127.0.0.1:4720/img/pixel-a.png", "currentSrc");
	});

	await check("a mutation observer never sees sherpa's bookkeeping", async () => {
		// Sherpa records the authored value in a sherpa-attr-* attribute, which
		// is a DOM mutation like any other: an observer saw two records per
		// rewritten attribute, one of them for an attribute the page has never
		// heard of, and the real one carried a proxied oldValue.
		const el = document.createElement("a");
		el.setAttribute("href", "/one");
		document.body.appendChild(el);
		const seen = [];
		const observer = new MutationObserver((records) => {
			for (const record of records)
				seen.push(record.attributeName + "=" + record.oldValue);
		});
		observer.observe(el, { attributes: true, attributeOldValue: true });
		el.setAttribute("href", "/two");
		await new Promise((r) => setTimeout(r, 50));
		const taken = observer.takeRecords();
		observer.disconnect();
		el.remove();

		eq(seen.join(","), "href=/one", "records the page sees");
		return eq(taken.length, 0, "takeRecords is filtered too");
	});

	await check("a proxied event keeps the object protocol every event has", async () => {
		// The per-type accessor tables were plain objects, so membership tests
		// hit Object.prototype: reading event.toString returned the *string*
		// "[object MessageEvent]" (so String(event) threw), event.constructor
		// was the event itself, and event.hasOwnProperty threw outright.
		const event = await new Promise((resolveEvent, rejectEvent) => {
			addEventListener("message", function once(received) {
				removeEventListener("message", once);
				resolveEvent(received);
			});
			setTimeout(() => rejectEvent(new Error("no message delivered")), 10000);
			postMessage("shape-probe", "*");
		});

		eq(typeof event.toString, "function", "toString is a function");
		eq(String(event), "[object MessageEvent]", "String(event)");
		eq(event.constructor, MessageEvent, "constructor");
		eq(typeof event.hasOwnProperty, "function", "hasOwnProperty is a function");
		eq(event.hasOwnProperty("nothing"), false, "hasOwnProperty is callable");
		eq(event.data, "shape-probe", "data survives the proxy");
		return eq(event.origin, location.origin, "origin is the virtual one");
	});

	await check("a document's realm only receives cookies it may read", async () => {
		// Every virtual origin here shares one physical origin, so a proxied
		// page can reach the client object of any frame it embeds. The jar
		// injected into a realm therefore has to be scoped exactly the way
		// document.cookie is - to that host, and never httpOnly. It used to be
		// the whole jar, so one iframe handed a page every other site's session.
		await fetch("/set-cookie");
		await fetch("http://127.0.0.2:4722/set-cookie", { mode: "cors" });

		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		await new Promise((done, fail) => {
			frame.addEventListener("load", done, { once: true });
			setTimeout(() => fail(new Error("timed out")), 15000);
			frame.src = "/api/echo.html";
		});

		const inner = frame.contentWindow;
		const jar = inner[Symbol.for("scramjet client global")].cookieStore.dump();
		const cookie = inner.document.cookie;
		frame.remove();

		if (jar.indexOf("ALT_PUBLIC_VALUE") !== -1 || jar.indexOf("ALT_SECRET_VALUE") !== -1)
			throw new Error("another origin's cookies reached this realm: " + jar);
		if (jar.indexOf("OWN_SECRET_VALUE") !== -1)
			throw new Error("an httpOnly cookie reached this realm: " + jar);
		if (jar.indexOf("OWN_PUBLIC_VALUE") === -1)
			throw new Error("this host's own cookie is missing: " + jar);

		eq(cookie.indexOf("ownpublic=OWN_PUBLIC_VALUE") !== -1, true, "document.cookie has the readable cookie");
		eq(cookie.indexOf("ownsession") === -1, true, "document.cookie hides the httpOnly cookie");

		return "ok";
	});

	await check("a GET form replaces the document's query instead of appending", async () => {
		// The browser mutates the *proxied* URL's query when a GET form with no
		// action submits, and per HTML that query replaces the action URL's own.
		// Concatenating them instead sent "?q=old&q=new" upstream - every
		// framework reads the first one, so the search box did nothing - and
		// left the page reading its own location back as "?q=old?q=new".
		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		const load = () =>
			new Promise((done, fail) => {
				frame.addEventListener("load", done, { once: true });
				setTimeout(() => fail(new Error("form navigation timed out")), 15000);
			});

		const first = load();
		frame.src = "/form.html?q=old&stale=1";
		await first;
		eq(frame.contentDocument.getElementById("upstream").textContent, "q=old&stale=1", "initial upstream query");
		eq(frame.contentDocument.getElementById("seen").textContent, "?q=old&stale=1", "initial location.search");

		const second = load();
		frame.contentDocument.getElementById("search").submit();
		await second;
		const upstream = frame.contentDocument.getElementById("upstream").textContent;
		const seen = frame.contentDocument.getElementById("seen").textContent;
		frame.remove();

		eq(upstream, "q=new&page=2", "submitted upstream query");
		eq(seen, "?q=new&page=2", "location.search after submitting");

		return "ok";
	});

	await check("nothing on the page was fetched from the proxy's own origin", async () => {
		// The single assertion every rewriting gap above shows up in: a url the
		// engine failed to rewrite resolves against the proxy origin instead of
		// the site's, and the request escapes there. Resource names are
		// unrewritten by the performance trap, so anything still pointing at the
		// proxy host is either an engine file or a leak.
		await new Promise((r) => setTimeout(r, 500));
		const leaked = performance
			.getEntriesByType("resource")
			.map((entry) => entry.name)
			.filter((name) => name.indexOf("http://127.0.0.1:4721/") === 0)
			.filter((name) => name.indexOf("/engine/") === -1 && name.indexOf("/baremux/") === -1 && name.indexOf("/epoxy/") === -1 && name.indexOf("/proxied/$") === -1);
		if (leaked.length)
			throw new Error("escaped to the proxy origin: " + leaked.join(", "));
		return "none";
	});

	window.__sherpaDone = true;
})();
`;

/**
 * Document variants for the streamed-response checks: each one is a different
 * doctype shape, and the padding pushes the interesting ones past the flush
 * threshold so they take the streaming path rather than the buffered fallback.
 */
const PADDING = `<p>${"filler ".repeat(220)}</p>`;
const docBody = `<p id="marker">marker</p><img id="pic" src="/img/pixel-a.png">`;

function docPage(doctype, { pad = true } = {}) {
	return `${doctype}<html><head><meta charset="utf-8"><title>doc</title></head><body>${docBody}${pad ? PADDING : ""}</body></html>`;
}

const documentShapes = {
	// A minimal proxied document, for checks that need a second realm.
	"/api/echo.html": `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>echo</body></html>`,
	"/doc/standards.html": docPage("<!DOCTYPE html>"),
	"/doc/quirks.html": docPage(""),
	"/doc/legacy.html": docPage(
		`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">`
	),
	"/doc/commented.html": docPage("<!-- a leading comment -->\n<!DOCTYPE html>"),
	"/doc/tiny.html": docPage("<!DOCTYPE html>", { pad: false }),
	"/doc/tiny-quirks.html": docPage("", { pad: false }),
};

export const pages = {
	"/index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="/base-root/">
<link rel="stylesheet" href="/site.css">
<title>sherpa behavior fixture</title>
</head>
<body class="fixture-body" background="/img/pixel-a.png">
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
<a class="pinged" href="/ping-target.html" ping="/beacon/one /beacon/two">ping</a>
<style id="inert-style" type="text/tailwindcss">.inert{background:url(/img/pixel-a.png)}</style>
<svg width="10" height="10">
	<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/sprite.svg#icon"></use>
	<use href="/sprite.svg#icon"></use>
</svg>
<script>window.__firstInlineRan = typeof location.href === "string" && location.href.indexOf("/proxied/") === -1;</script>
<div id="scripts"><script id="unicode-script">window.__unicodeValue = "café – 日本語 🏔";</script></div>
<script>${CHECKS}</script>
<script>${ASYNC_CHECKS}</script>
</body>
</html>`,
	...documentShapes,
};

export const textRoutes = {
	"/api/echo": { body: "echo", type: "text/plain" },
	"/site.css": {
		body: ".sheet-probe{background:url(/img/pixel-a.png)}",
		type: "text/css",
	},
	"/sprite.svg": {
		body: `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="icon"><rect width="4" height="4"/></symbol></svg>`,
		type: "image/svg+xml",
	},
	"/worker.js": {
		body: `postMessage({ href: self.location.href, search: self.location.search });`,
		type: "text/javascript",
	},
	// A real non-UTF-8 document: the streamed path has to sniff the charset from
	// the bytes it flushed on and decode the whole body with it.
	"/doc/shiftjis.html": {
		body: Buffer.concat([
			Buffer.from(
				`<!DOCTYPE html><html><head><title>sjis</title></head><body><p id="jp">`,
				"latin1"
			),
			// "こんにちは" in Shift_JIS
			Buffer.from([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]),
			Buffer.from(
				`</p><p>${"filler ".repeat(220)}</p></body></html>`,
				"latin1"
			),
		]),
		type: "text/html; charset=shift_jis",
	},
	"/doc/sniff.html": {
		body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${docBody}${PADDING}</body></html>`,
		type: "application/octet-stream",
	},
};

/** 1x1 transparent PNG, so the fixture's images are real responses. */
export const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64"
);
