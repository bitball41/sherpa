import { expect, test } from "@playwright/test";
import { setupPage } from "../../util/setupPage";

const FIXTURE_ORIGIN =
	process.env.PROXY_FIXTURE_ORIGIN || "http://127.0.0.1:1338";

test.describe("deterministic proxy fixture", () => {
	test("a document and form control load through Sherpa", async ({ page }) => {
		const frame = await setupPage(page, `${FIXTURE_ORIGIN}/document`);

		await expect(frame.locator("[data-page='document']")).toHaveText(
			"Fixture document"
		);
		await expect(frame.locator("textarea[title='Search']")).toBeVisible();
	});

	test("rewritten inline script reveals a nested proxied frame", async ({
		page,
	}) => {
		const frame = await setupPage(page, `${FIXTURE_ORIGIN}/nested`);
		await frame.locator("a[aria-label='Fixture apps']").click();

		const appsFrame = frame.locator("iframe[name='app']");
		await expect(appsFrame).toBeVisible();
		await expect(appsFrame.contentFrame().locator("c-wiz")).toHaveText(
			"Fixture apps loaded"
		);
		expect(await appsFrame.getAttribute("src")).not.toBeNull();
	});

	test("custom elements render in a proxied document", async ({ page }) => {
		const frame = await setupPage(page, `${FIXTURE_ORIGIN}/media`);

		await expect(frame.locator("#logo-icon > span > div")).toHaveText(
			"Fixture logo"
		);
	});

	test("query strings and subresource URLs survive rewriting", async ({
		page,
	}) => {
		const frame = await setupPage(
			page,
			`${FIXTURE_ORIGIN}/results?search_query=bad+apple`
		);
		await expect(
			frame.locator("#video-title > yt-formatted-string")
		).toHaveText("bad apple");

		const thumbnail = frame.locator(
			"#contents > ytd-video-renderer:nth-child(1) > #dismissible > ytd-thumbnail > a > yt-image > img"
		);
		await expect(thumbnail).toBeVisible();
		await expect(thumbnail).toHaveJSProperty("naturalWidth", 160);
		expect(await thumbnail.getAttribute("src")).not.toBeNull();
	});
});
