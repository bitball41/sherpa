// Deterministic fixture site for the end-to-end benchmark. All URLs are
// RELATIVE so that every subresource resolves through the proxy back to this
// local origin - no external network, no variance from the internet.
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
	"the quick brown fox jumps over lazy dog mountain river summit trail glacier ridge valley porter guide camp alpine ascent".split(
		" "
	);
const text = (rand, n) =>
	Array.from({ length: n }, () => WORDS[(rand() * WORDS.length) | 0]).join(" ");

function page(
	rand,
	{ sections, links, imgs, styles, inlineScripts, extScripts, cssFiles }
) {
	const p = [];
	p.push(
		`<!DOCTYPE html><html><head><meta charset="utf-8"><title>bench</title>`
	);
	for (let i = 0; i < cssFiles; i++)
		p.push(`<link rel="stylesheet" href="/css/sheet${i}.css">`);
	for (let i = 0; i < extScripts; i++)
		p.push(`<script src="/js/app${i}.js" defer></script>`);
	p.push(`</head><body>`);
	for (let s = 0; s < sections; s++) {
		p.push(`<section class="sec${s % 10}"><h2>${text(rand, 4)}</h2>`);
		for (let i = 0; i < links; i++) {
			const style =
				styles && rand() < 0.3
					? ` style="background-image:url(/img/px${(rand() * 8) | 0}.png);color:#333"`
					: "";
			p.push(
				`<p${style}>${text(rand, 16)} <a href="/page/${(rand() * 50) | 0}.html">${text(rand, 3)}</a></p>`
			);
		}
		for (let i = 0; i < imgs; i++) {
			const b = `/img/px${(rand() * 8) | 0}`;
			p.push(
				`<img src="${b}.png" srcset="${b}-320.png 320w, ${b}-640.png 640w, ${b}-1280.png 1280w" sizes="100vw" alt="x" loading="eager">`
			);
		}
		p.push(`</section>`);
	}
	for (let i = 0; i < inlineScripts; i++) {
		p.push(`<script>
(function(){
	var reg${i} = [];
	for (var j = 0; j < 40; j++) reg${i}.push({ id: j, path: location.pathname + '#' + j });
	window.__bench${i} = reg${i}.length;
	document.addEventListener('click', function(e){ window.__c${i} = (window.__c${i}||0)+1; });
})();
</script>`);
	}
	p.push(`</body></html>`);

	return p.join("\n");
}

function jsFile(rand, statements) {
	const lines = [`(function(){`, `"use strict";`, `var registry = {};`];
	for (let i = 0; i < statements; i++) {
		const k = rand();
		if (k < 0.25)
			lines.push(
				`registry["k${i}"] = function(a, b) { var u = location.href; return a + b + u.length + ${i}; };`
			);
		else if (k < 0.5)
			lines.push(
				`registry["o${i}"] = { id: ${i}, name: "${text(rand, 2)}", nested: { fn: function(x) { return x * ${i}; }, arr: [1, 2, ${i}] } };`
			);
		else if (k < 0.7)
			lines.push(
				`if (typeof window !== "undefined" && window.top === window.self) { registry["t${i}"] = ${i}; }`
			);
		else if (k < 0.85)
			lines.push(
				`registry["c${i}"] = class C${i} { constructor() { this.v = ${i}; } get double() { return this.v * 2; } };`
			);
		else
			lines.push(
				`registry["s${i}"] = "${text(rand, 6)}".split(" ").map(function(w) { return w.length + ${i}; });`
			);
	}
	lines.push(`window.__registryCount = Object.keys(registry).length;`);
	lines.push(`})();`);

	return lines.join("\n");
}

function cssFile(rand, rules) {
	const p = [];
	for (let i = 0; i < rules; i++) {
		if (rand() < 0.12)
			p.push(
				`.sec${i % 10} .r${i}{background-image:url(/img/px${(rand() * 8) | 0}.png)}`
			);
		else
			p.push(
				`.sec${i % 10} .r${i}{color:#${((rand() * 0xffffff) | 0).toString(16).padStart(6, "0")};margin:${i % 20}px}`
			);
	}

	return p.join("\n");
}

// tiny valid 1x1 png
export const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64"
);

export const pages = {
	// long article: rewriter-bound document, some assets
	"/article.html": page(mulberry32(11), {
		sections: 40,
		links: 10,
		imgs: 2,
		styles: true,
		inlineScripts: 3,
		extScripts: 1,
		cssFiles: 2,
	}),
	// script-heavy SPA-ish page: exercises the WASM JS rewriter
	"/app.html": page(mulberry32(22), {
		sections: 4,
		links: 3,
		imgs: 1,
		styles: false,
		inlineScripts: 4,
		extScripts: 4,
		cssFiles: 1,
	}),
	// media grid: srcset-heavy
	"/gallery.html": page(mulberry32(33), {
		sections: 25,
		links: 4,
		imgs: 8,
		styles: true,
		inlineScripts: 2,
		extScripts: 1,
		cssFiles: 2,
	}),
	// small landing page
	"/landing.html": page(mulberry32(44), {
		sections: 5,
		links: 4,
		imgs: 2,
		styles: true,
		inlineScripts: 1,
		extScripts: 1,
		cssFiles: 1,
	}),
};

const jsRand = mulberry32(55);
export const jsFiles = {};
for (let i = 0; i < 5; i++) jsFiles[`/js/app${i}.js`] = jsFile(jsRand, 260);

const cssRand = mulberry32(66);
export const cssFiles = {};
for (let i = 0; i < 3; i++)
	cssFiles[`/css/sheet${i}.css`] = cssFile(cssRand, 700);
