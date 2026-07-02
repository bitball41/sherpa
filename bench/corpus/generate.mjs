// Deterministic benchmark corpus generator.
//
// Every fixture is generated from a fixed PRNG seed, so any two runs of this
// script produce byte-identical files on any machine. The page shapes are
// modeled on common real-world page archetypes (long article, news front
// page, product grid, SPA shell) with element/attribute mixes in line with
// what HTML rewriting proxies actually see: lots of <a href>, <img
// src/srcset>, inline styles, inline scripts, and event-handler attributes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

// mulberry32: tiny, seedable, deterministic PRNG
function mulberry32(seed) {
	let a = seed >>> 0;

	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS =
	"the quick brown fox jumps over lazy dog mountain river summit trail glacier ridge valley porter guide camp basecamp alpine ascent descent traverse crampon ice rock snow wind weather forecast route map compass altitude oxygen".split(
		" "
	);

function makeText(rand, words) {
	const out = [];
	for (let i = 0; i < words; i++) out.push(WORDS[(rand() * WORDS.length) | 0]);

	return out.join(" ");
}

const HOSTS = [
	"https://example.com",
	"https://cdn.example.com",
	"https://static.example.org",
	"https://img.example.net",
	"//assets.example.com",
	"",
];

function makeUrl(rand, ext = "") {
	const host = HOSTS[(rand() * HOSTS.length) | 0];
	const depth = 1 + ((rand() * 3) | 0);
	const segs = [];
	for (let i = 0; i < depth; i++)
		segs.push(makeText(rand, 1) + ((rand() * 1000) | 0));
	let url = `${host}/${segs.join("/")}${ext}`;
	if (rand() < 0.3)
		url += `?id=${(rand() * 100000) | 0}&ref=${makeText(rand, 1)}`;
	if (rand() < 0.15) url += `#${makeText(rand, 1)}`;

	return url;
}

function makeSrcset(rand) {
	const n = 2 + ((rand() * 3) | 0);
	const base = makeUrl(rand, ".jpg").split("?")[0];
	const parts = [];
	for (let i = 0; i < n; i++) {
		const w = 320 * (i + 1);
		parts.push(`${base.replace(".jpg", `-${w}w.jpg`)} ${w}w`);
	}

	return parts.join(", ");
}

const EVENT_ATTRS = [
	"onclick",
	"onmouseover",
	"onload",
	"onchange",
	"onsubmit",
];

function makeInlineHandler(rand) {
	return `trackEvent('${makeText(rand, 1)}', ${(rand() * 100) | 0}); this.classList.toggle('active')`;
}

function makeInlineStyle(rand) {
	const styles = [
		`background-image: url(${makeUrl(rand, ".png")})`,
		`color: #${((rand() * 0xffffff) | 0).toString(16).padStart(6, "0")}`,
		`width: ${(rand() * 100) | 0}%`,
		`margin: ${(rand() * 20) | 0}px`,
	];

	return styles.slice(0, 1 + ((rand() * 3) | 0)).join("; ");
}

function makeInlineScript(rand, statements) {
	const lines = [];
	for (let i = 0; i < statements; i++) {
		const v = `v${i}`;
		const kind = rand();
		if (kind < 0.3)
			lines.push(
				`var ${v} = document.querySelector('.c${(rand() * 100) | 0}');`
			);
		else if (kind < 0.6)
			lines.push(
				`window.__data${i} = { id: ${(rand() * 1e6) | 0}, name: '${makeText(rand, 2)}', url: '${makeUrl(rand)}' };`
			);
		else if (kind < 0.8)
			lines.push(
				`if (location.pathname.indexOf('${makeText(rand, 1)}') !== -1) { console.log('${makeText(rand, 2)}'); }`
			);
		else
			lines.push(
				`document.addEventListener('${["click", "scroll", "load"][(rand() * 3) | 0]}', function(e) { trackEvent('${makeText(rand, 1)}'); });`
			);
	}

	return lines.join("\n");
}

function htmlPage(
	rand,
	{
		title,
		sections,
		linksPerSection,
		imgsPerSection,
		inlineScripts,
		scriptStatements,
		styled,
		handlers,
	}
) {
	const parts = [];
	parts.push(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${makeUrl(rand, ".css")}">
<link rel="stylesheet" href="${makeUrl(rand, ".css")}">
<link rel="preload" as="image" imagesrcset="${makeSrcset(rand)}">
<link rel="icon" href="/favicon.ico">
<meta property="og:image" content="${makeUrl(rand, ".jpg")}">
<style>
body { font-family: system-ui, sans-serif; margin: 0; }
.hero { background: url(${makeUrl(rand, ".jpg")}) center/cover; }
@import "${makeUrl(rand, ".css")}";
</style>
<script src="${makeUrl(rand, ".js")}" defer></script>
<script type="module" src="${makeUrl(rand, ".mjs")}"></script>
</head>
<body>`);

	parts.push(`<header><nav>`);
	for (let i = 0; i < 12; i++)
		parts.push(`<a href="${makeUrl(rand)}">${makeText(rand, 2)}</a>`);
	parts.push(`</nav></header>`);

	for (let s = 0; s < sections; s++) {
		parts.push(`<section id="s${s}" class="c${s % 20}">`);
		parts.push(`<h2>${makeText(rand, 5)}</h2>`);
		for (let i = 0; i < linksPerSection; i++) {
			const style =
				styled && rand() < 0.25 ? ` style="${makeInlineStyle(rand)}"` : "";
			const handler =
				handlers && rand() < 0.12
					? ` ${EVENT_ATTRS[(rand() * EVENT_ATTRS.length) | 0]}="${makeInlineHandler(rand)}"`
					: "";
			parts.push(
				`<p${style}>${makeText(rand, 20)} <a href="${makeUrl(rand)}"${handler}>${makeText(rand, 3)}</a> ${makeText(rand, 15)}</p>`
			);
		}
		for (let i = 0; i < imgsPerSection; i++) {
			if (rand() < 0.6) {
				parts.push(
					`<img src="${makeUrl(rand, ".jpg")}" srcset="${makeSrcset(rand)}" sizes="(max-width: 600px) 100vw, 50vw" alt="${makeText(rand, 3)}" loading="lazy">`
				);
			} else {
				parts.push(
					`<picture><source srcset="${makeSrcset(rand)}" type="image/webp"><img src="${makeUrl(rand, ".jpg")}" alt="${makeText(rand, 2)}"></picture>`
				);
			}
		}
		if (rand() < 0.3)
			parts.push(
				`<form action="${makeUrl(rand)}" method="post"><input name="q" placeholder="${makeText(rand, 2)}"><button type="submit">${makeText(rand, 1)}</button></form>`
			);
		if (rand() < 0.2)
			parts.push(`<iframe src="${makeUrl(rand)}" loading="lazy"></iframe>`);
		parts.push(`</section>`);
	}

	for (let i = 0; i < inlineScripts; i++) {
		parts.push(
			`<script>\n${makeInlineScript(rand, scriptStatements)}\n</script>`
		);
	}

	parts.push(`<footer>`);
	for (let i = 0; i < 30; i++)
		parts.push(`<a href="${makeUrl(rand)}">${makeText(rand, 2)}</a>`);
	parts.push(`</footer></body></html>`);

	return parts.join("\n");
}

function cssFile(rand, rules) {
	const parts = [
		`@import url("${makeUrl(rand, ".css")}");`,
		`@import "${makeUrl(rand, ".css")}";`,
	];
	for (let i = 0; i < rules; i++) {
		const sel = `.c${i % 500} .x${(rand() * 100) | 0}`;
		const kind = rand();
		if (kind < 0.12) {
			parts.push(
				`${sel} { background-image: url("${makeUrl(rand, ".png")}"); background-size: cover; }`
			);
		} else if (kind < 0.16) {
			parts.push(
				`@font-face { font-family: F${i}; src: url(${makeUrl(rand, ".woff2")}) format("woff2"), url('${makeUrl(rand, ".woff")}') format("woff"); }`
			);
		} else {
			parts.push(
				`${sel} { color: #${((rand() * 0xffffff) | 0).toString(16).padStart(6, "0")}; margin: ${(rand() * 20) | 0}px; padding: ${(rand() * 10) | 0}px ${(rand() * 10) | 0}px; display: flex; }`
			);
		}
	}

	return parts.join("\n");
}

function urlList(rand, n) {
	const urls = [];
	for (let i = 0; i < n; i++) {
		const k = rand();
		if (k < 0.45)
			urls.push(makeUrl(rand)); // absolute / protocol-relative / relative
		else if (k < 0.75)
			urls.push(
				`/${makeText(rand, 1)}/${makeText(rand, 1)}${(rand() * 1000) | 0}`
			);
		else if (k < 0.85)
			urls.push(`../${makeText(rand, 1)}/${(rand() * 1000) | 0}.html`);
		else if (k < 0.92) urls.push(`?page=${(rand() * 100) | 0}`);
		else if (k < 0.96) urls.push(`#${makeText(rand, 1)}`);
		else if (k < 0.98) urls.push(`mailto:${makeText(rand, 1)}@example.com`);
		else urls.push(`data:text/plain;base64,aGVsbG8=`);
	}

	return urls;
}

const fixtures = {
	// long-form article: link-dense, Wikipedia-like
	"article.html": htmlPage(mulberry32(1001), {
		title: "Article",
		sections: 60,
		linksPerSection: 14,
		imgsPerSection: 2,
		inlineScripts: 4,
		scriptStatements: 20,
		styled: true,
		handlers: false,
	}),
	// news front page: media + handler heavy
	"news.html": htmlPage(mulberry32(2002), {
		title: "News",
		sections: 35,
		linksPerSection: 10,
		imgsPerSection: 6,
		inlineScripts: 10,
		scriptStatements: 30,
		styled: true,
		handlers: true,
	}),
	// e-commerce grid: srcset/product-card heavy
	"shop.html": htmlPage(mulberry32(3003), {
		title: "Shop",
		sections: 50,
		linksPerSection: 6,
		imgsPerSection: 10,
		inlineScripts: 6,
		scriptStatements: 25,
		styled: true,
		handlers: true,
	}),
	// SPA shell: small DOM, big inline scripts
	"spa.html": htmlPage(mulberry32(4004), {
		title: "App",
		sections: 6,
		linksPerSection: 3,
		imgsPerSection: 1,
		inlineScripts: 8,
		scriptStatements: 220,
		styled: false,
		handlers: false,
	}),
	// small marketing page
	"small.html": htmlPage(mulberry32(5005), {
		title: "Landing",
		sections: 8,
		linksPerSection: 5,
		imgsPerSection: 2,
		inlineScripts: 2,
		scriptStatements: 15,
		styled: true,
		handlers: true,
	}),
	"framework.css": cssFile(mulberry32(6006), 4200),
	"site.css": cssFile(mulberry32(7007), 900),
	"urls.json": JSON.stringify(urlList(mulberry32(8008), 5000), null, "\t"),
};

for (const [name, content] of Object.entries(fixtures)) {
	writeFileSync(join(outDir, name), content);
	console.log(
		`${name.padEnd(16)} ${(Buffer.byteLength(content) / 1024).toFixed(1).padStart(8)} KiB`
	);
}
