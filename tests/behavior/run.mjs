// Behavior suite: boots Sherpa's real pipeline in Chromium against a local
// fixture origin and runs the fixture's own assertions inside the proxied
// document.
//
//   node tests/behavior/run.mjs
//
// Unlike the unit tests, which exercise leaf modules in Node, this drives the
// service worker, the WASM rewriter and every client-side trap exactly as a
// browsing session does.
import { chromium } from "playwright";
import {
	startOriginServer,
	startAltOriginServer,
	startHostServer,
	ORIGIN_PORT,
	HOST_PORT,
} from "./servers.mjs";

const TARGET = `http://127.0.0.1:${ORIGIN_PORT}/index.html`;

const servers = [
	await startOriginServer(),
	await startAltOriginServer(),
	await startHostServer(),
];
// `SHERPA_CHROMIUM` lets an environment that ships its own Chromium (a CI
// image with a pre-installed browser, say) point the suite at it instead of
// requiring `npx playwright install`.
const browser = await chromium.launch({
	executablePath: process.env.SHERPA_CHROMIUM || undefined,
	args: ["--enable-features=SharedArrayBuffer"],
});

let failures = 0;
try {
	const context = await browser.newContext();
	const page = await context.newPage();

	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(String(error)));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	await page.goto(`http://127.0.0.1:${HOST_PORT}/harness.html`);
	await page.evaluate(() => window.harnessReady);
	const href = await page.evaluate(
		(url) => window.harnessNavigate(url),
		TARGET
	);

	const frame = page
		.frames()
		.find((f) => f !== page.mainFrame() && f.url() === href);
	if (!frame) throw new Error(`could not find the proxied frame for ${href}`);

	await frame.waitForFunction(() => window.__sherpaDone === true, null, {
		timeout: 30000,
	});

	const results = await frame.evaluate(() => window.__sherpaResults);

	for (const result of results) {
		if (result.ok) {
			console.log(
				`  ok   ${result.name}${result.detail ? ` (${result.detail})` : ""}`
			);
		} else {
			failures++;
			console.log(`  FAIL ${result.name}\n         ${result.detail}`);
		}
	}

	console.log(
		`\n${results.length - failures}/${results.length} checks passed inside the proxied page`
	);

	// A trap that throws is a failure even when every assertion happened to
	// pass around it.
	const realErrors = pageErrors.filter((text) => !/favicon|ERR_/.test(text));
	if (realErrors.length) {
		failures++;
		console.log(`\nunexpected console/page errors:`);
		for (const error of realErrors) console.log(`  ${error}`);
	}
} finally {
	await browser.close();
	for (const server of servers) server.close();
}

process.exit(failures === 0 ? 0 : 1);
