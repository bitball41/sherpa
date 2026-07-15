import { test, expect } from "@playwright/test";
import { setupPage } from "../../util/setupPage";

const RUN_LIVE_SITE_TESTS = process.env.LIVE_SITE_TESTS === "1";

test.describe("Google (live)", () => {
	test.beforeEach(() => {
		test.skip(
			!RUN_LIVE_SITE_TESTS,
			"Set LIVE_SITE_TESTS=1 to run checks that depend on Google"
		);
	});
	test("The front page can load.", async ({ page }) => {
		const frame = await setupPage(page, "https://www.google.com/");

		await expect(
			frame.locator("textarea[Title='Search']").first()
		).toBeVisible();
	});

	test("The Google Apps menu opens and content is visible.", async ({
		page,
	}) => {
		const frame = await setupPage(page, "https://www.google.com/");

		await frame.locator("a[aria-label='Google apps']").first().click();

		const appsMenuFrame = frame.locator("iframe[name='app']");
		await appsMenuFrame.waitFor({ state: "visible" });

		await appsMenuFrame
			.contentFrame()
			.locator("c-wiz")
			.first()
			.waitFor({ state: "visible" });

		const appsMenu = await appsMenuFrame.getAttribute("src");

		expect(appsMenu).not.toBeNull();
	});
});
