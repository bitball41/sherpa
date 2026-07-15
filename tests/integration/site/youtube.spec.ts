import { test, expect } from "@playwright/test";
import { setupPage } from "../../util/setupPage";

const RUN_LIVE_SITE_TESTS = process.env.LIVE_SITE_TESTS === "1";

test.describe("YouTube (live)", () => {
	test.beforeEach(() => {
		test.skip(
			!RUN_LIVE_SITE_TESTS,
			"Set LIVE_SITE_TESTS=1 to run checks that depend on YouTube"
		);
	});
	test("The front page can load.", async ({ page }) => {
		const frame = await setupPage(page, "https://www.youtube.com/");

		// Wait for the page inside the iframe to load

		const logo = await frame
			.locator("#logo-icon > span > div")
			.first()
			.waitFor({ state: "visible" });
		expect(logo).not.toBeNull();
	});

	test("The search page can load.", async ({ page }) => {
		const frame = await setupPage(
			page,
			"https://www.youtube.com/results?search_query=bad+apple"
		);

		const title = await frame
			.locator("#video-title > yt-formatted-string")
			.first()
			.textContent();
		const thumbnailRef = frame.locator(
			"#contents > ytd-video-renderer:nth-child(1) > #dismissible > ytd-thumbnail > a > yt-image > img"
		);
		await thumbnailRef.waitFor({ state: "visible" });

		const thumbnail = await thumbnailRef.getAttribute("src");

		expect(title).not.toBeNull();
		expect(thumbnail).not.toBeNull();
	});
});
