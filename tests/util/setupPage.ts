import { expect, FrameLocator, Page } from "@playwright/test";
import { registerInspect } from "./inspectConsole";

export async function setupPage(
	page: Page,
	url: string
): Promise<FrameLocator> {
	registerInspect(page);

	// Interception disables the HTTP cache. It also selects the local Bare
	// transport so the required suite does not depend on Wisp or public egress.
	const transport =
		process.env.PROXY_TEST_TRANSPORT || "/baremod/index.mjs";
	await page.route("**", (route) => {
		if (new URL(route.request().url()).pathname === "/config.js") {
			return route.fulfill({
				contentType: "application/javascript",
				body: `let _CONFIG = { transport: ${JSON.stringify(transport)} };\n`,
			});
		}

		return route.continue();
	});
	// Goto base url defined in config.
	await page.goto("/");
	await page.waitForSelector(".version > b");
	const bar = page.locator(".bar");
	const title = await page.locator(".version > b").textContent();
	const frame = page.frameLocator("iframe");
	expect(title).toBe("sherpa");

	await expect(bar).toBeVisible();

	await bar.fill(url);
	const proxiedPrefix = new URL("/sherpa/", page.url()).href;
	const navigation = page.waitForEvent("framenavigated", {
		predicate: (navigatedFrame) =>
			navigatedFrame.parentFrame() === page.mainFrame() &&
			navigatedFrame.url().startsWith(proxiedPrefix),
		timeout: 30_000,
	});
	await bar.press("Enter");
	await navigation;

	return frame;
}
