// Output-equivalence verification: the optimized rewriters must produce
// byte-identical output to the pre-optimization baseline (bench/.baseline)
// across the whole corpus plus a battery of adversarial edge cases.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));

globalThis.self = globalThis;
globalThis.location = new URL("https://proxy.invalid/");
globalThis.__benchdbg = {
	log() {},
	warn() {},
	error() {},
	debug() {},
	time() {},
};

if (!existsSync(join(benchDir, "out/baseline.rewriters.mjs"))) {
	console.error(
		"baseline bundle missing - run `BENCH_BASELINE_REF=<commit> node build.mjs` first"
	);
	process.exit(1);
}

const cur = await import(join(benchDir, "out/sherpa.rewriters.mjs"));
const base = await import(join(benchDir, "out/baseline.rewriters.mjs"));

function makeConfig() {
	return {
		prefix: "/proxy/",
		globals: {
			wrapfn: "$proxy$wrap",
			wrappropertybase: "$proxy__",
			wrappropertyfn: "$proxy$prop",
			cleanrestfn: "$proxy$clean",
			importfn: "$proxy$import",
			rewritefn: "$proxy$rewrite",
			metafn: "$proxy$meta",
			setrealmfn: "$proxy$setrealm",
			pushsourcemapfn: "$proxy$pushsourcemap",
			trysetfn: "$proxy$tryset",
			templocid: "$proxy$temploc",
			tempunusedid: "$proxy$tempunused",
		},
		files: {
			wasm: "/engine.wasm.wasm",
			all: "/engine.all.js",
			sync: "/engine.sync.js",
		},
		flags: {
			serviceworkers: false,
			syncxhr: false,
			strictRewrites: true,
			rewriterLogs: false,
			captureErrors: true,
			cleanErrors: false,
			scramitize: false,
			sourcemaps: false,
			destructureRewrites: false,
			interceptDownloads: false,
			allowInvalidJs: true,
			allowFailedIntercepts: true,
		},
		siteFlags: {},
		errorPage: {},
		codec: {
			encode:
				"(url) => { if (!url) return url; return encodeURIComponent(url); }",
			decode:
				"(url) => { if (!url) return url; return decodeURIComponent(url); }",
		},
	};
}

cur.setConfig(makeConfig());
base.setConfig(makeConfig());

const ORIGIN = new URL("https://example.com/section/page.html");
const meta = () => ({ origin: ORIGIN, base: ORIGIN });

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, a, b) {
	if (a === b) {
		pass++;
	} else {
		fail++;
		let i = 0;
		while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
		failures.push({
			name,
			at: i,
			cur: String(a).slice(Math.max(0, i - 60), i + 80),
			base: String(b).slice(Math.max(0, i - 60), i + 80),
		});
	}
}

// ---- corpus ----
const corpusDir = join(benchDir, "corpus/out");
for (const f of readdirSync(corpusDir)) {
	const content = readFileSync(join(corpusDir, f), "utf8");
	if (f.endsWith(".html")) {
		eq(
			`rewriteHtml ${f}`,
			cur.rewriteHtml(content, new cur.CookieStore(), meta(), true),
			base.rewriteHtml(content, new base.CookieStore(), meta(), true)
		);
		const rewritten = cur.rewriteHtml(
			content,
			new cur.CookieStore(),
			meta(),
			false
		);
		eq(
			`unrewriteHtml ${f}`,
			cur.unrewriteHtml(rewritten),
			base.unrewriteHtml(rewritten)
		);
	} else if (f.endsWith(".css")) {
		eq(
			`rewriteCss ${f}`,
			cur.rewriteCss(content, meta()),
			base.rewriteCss(content, meta())
		);
	} else if (f === "urls.json") {
		const urls = JSON.parse(content);
		for (const u of urls) {
			const a = cur.rewriteUrl(u, meta());
			const b = base.rewriteUrl(u, meta());
			eq(`rewriteUrl ${u}`, a, b);
			eq(`unrewriteUrl ${u}`, cur.unrewriteUrl(a), base.unrewriteUrl(b));
		}
	}
}

// ---- adversarial edge cases ----
const urlEdge = [
	"",
	"#",
	"#frag",
	"?q=1#x",
	"https://example.com",
	"https://example.com/#",
	"https://example.com/#a#b",
	"https://example.com/path#%20%23",
	"HTTPS://EXAMPLE.COM/UP",
	"//cdn.example.com/x",
	"/abs/path",
	"rel/path/../up",
	"mailto:x@y.z",
	"about:blank",
	"about:srcdoc",
	"data:text/plain,hi",
	"data:image/png;base64,AAA,BBB",
	"blob:https://example.com/uuid-here",
	"javascript:void(0)",
	"tel:+1234567890",
	"magnet:?xt=urn:btih:deadbeef",
	"intent://scan/#Intent;scheme=zxing;end",
	"ws://example.com/socket",
	"ftp://example.com/file",
	"a-scheme-not-about:x",
	"bad url with spaces",
	"http://user:pass@example.com:8080/p?q#f",
	"https://例え.テスト/パス",
	"https://example.com/%",
];
for (const u of urlEdge) {
	let a, b;
	try {
		a = cur.rewriteUrl(u, meta());
	} catch (e) {
		a = `THREW:${e.constructor.name}`;
	}
	try {
		b = base.rewriteUrl(u, meta());
	} catch (e) {
		b = `THREW:${e.constructor.name}`;
	}
	eq(`rewriteUrl(edge) ${JSON.stringify(u)}`, a, b);
	if (!String(a).startsWith("THREW")) {
		eq(
			`unrewriteUrl(edge) ${JSON.stringify(u)}`,
			cur.unrewriteUrl(a),
			base.unrewriteUrl(b)
		);
	}
}
// unrewrite of things that aren't ours
for (const u of [
	"https://other.origin/proxy/https%3A%2F%2Fx",
	"https://proxy.invalid/notproxy/x",
	"https://proxy.invalid/proxy/blob:https://proxy.invalid/id",
	"https://proxy.invalid/proxy/data:text/plain,hi",
	"https://proxy.invalid/proxy/https%3A%2F%2Fexample.com%2F#h%20x",
	"javascript:alert(1)",
	"blob:https://proxy.invalid/raw",
	"mailto:a@b.c",
	"about:blank",
	"tel:+15551234",
]) {
	eq(`unrewriteUrl(raw) ${u}`, cur.unrewriteUrl(u), base.unrewriteUrl(u));
}

const cssEdge = [
	`a { background: url( "https://x.example/a.png" ) }`,
	`a { background: url('/a(b).png') }`,
	`a { background: url(a.png) url("b.png") }`,
	`@import url("x.css");`,
	`@import url(x.css) screen;`,
	`@import "y.css" print;`,
	`@import 'z.css';`,
	`@import  spaced.css ;`,
	`.x{background:url(data:image/svg+xml,<svg viewBox='0 0 1 1'/>)}`,
	`.q{content:"url(not-a-url.png)"}`,
	`/* url(in-comment.png) */ .z{color:red}`,
	`.multi { background: url(one.png), url('two.png'), url("three.png"); }`,
	`@font-face{src:url(f.woff2) format("woff2")}`,
	``,
	`no urls here at all`,
];
for (const [i, css] of cssEdge.entries()) {
	eq(
		`rewriteCss(edge ${i})`,
		cur.rewriteCss(css, meta()),
		base.rewriteCss(css, meta())
	);
	eq(`unrewriteCss(edge ${i})`, cur.unrewriteCss(css), base.unrewriteCss(css));
}

const htmlEdge = [
	`<img srcset="a.png 1x, b.png 2x">`,
	`<img srcset="a.png, b.png">`,
	`<img srcset="a.png">`,
	`<img srcset=" , ,a.png 1x,, b.png 2x , ">`,
	`<img srcset="data:image/png;base64,AA,BB 1x, c.png 2x">`,
	`<img srcset="a.png calc(1x + 2x), b.png 2x">`,
	`<img srcset="a.png 1x, b.png 2x">`,
	`<source srcset="x.webp 100w, y.webp 200w" sizes="100vw">`,
	`<base href="/deep/base/"><a href="rel.html">x</a>`,
	`<meta http-equiv="Refresh" content="5; URL='/next.html'">`,
	`<meta http-equiv="content-security-policy" content="default-src 'self'">`,
	`<script>var x = 1 < 2; //<!-- not a comment --></script>`,
	`<script type="">document.title</script>`,
	`<script type="TEXT/JavaScript;charset=utf-8">var a=1</script>`,
	`<script type="application/ld+json">{"@context":"https://schema.org"}</script>`,
	`<script type="importmap">{"imports":{"a":"/mod.js"}}</script>`,
	`<script type="module" src="/m.js"></script>`,
	`<style>.a{background:url(/i.png)}</style>`,
	`<div style="background-image: url(/x.png)" onclick="go(location.href)">t</div>`,
	`<a href="tel:+1555">call</a><a href="intent://x#Intent;end">app</a>`,
	`<p>unclosed <b>tags <i>every`,
	`<!-- comment --><![CDATA[not html]]>`,
	`<svg><image href="/v.svg"/></svg>`,
	`<iframe srcdoc="&lt;a href='/inner.html'&gt;i&lt;/a&gt;"></iframe>`,
	``,
];
for (const [i, html] of htmlEdge.entries()) {
	eq(
		`rewriteHtml(edge ${i})`,
		cur.rewriteHtml(html, new cur.CookieStore(), meta(), false),
		base.rewriteHtml(html, new base.CookieStore(), meta(), false)
	);
}

// full-page injection path (fromTop) with a cookie store carrying state
{
	const store = (v) => {
		const s = new v.CookieStore();
		s.setCookies(
			["session=abc123; Path=/; Secure", "theme=dark; Path=/"],
			ORIGIN
		);

		return s;
	};
	const page = `<!DOCTYPE html><html><head><title>t</title></head><body><a href="/x">x</a></body></html>`;
	eq(
		`rewriteHtml fromTop+cookies`,
		cur.rewriteHtml(page, store(cur), meta(), true),
		base.rewriteHtml(page, store(base), meta(), true)
	);
}

console.log(`\n${pass} equivalent, ${fail} divergent`);
if (fail) {
	for (const f of failures.slice(0, 25)) {
		console.log(`\n--- ${f.name} (first diff at ${f.at})`);
		console.log(`  optimized: ...${f.cur}...`);
		console.log(`  baseline : ...${f.base}...`);
	}
	process.exitCode = 1;
}
