import { Page } from "@playwright/test";

const MAX_REPORTED_BROWSER_ERRORS = 25;

export function registerInspect(page: Page) {
	const reported = new Set<string>();
	const report = (message: string) => {
		if (
			reported.has(message) ||
			reported.size >= MAX_REPORTED_BROWSER_ERRORS
		)
			return;

		reported.add(message);
		console.error(message);
	};

	page.on("console", (message) => {
		if (message.type() === "error") {
			report(`[browser console] ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => {
		report(`[browser page error] ${error.stack || error.message}`);
	});
	page.on("requestfailed", (request) => {
		if (!request.isNavigationRequest()) return;

		report(
			`[browser navigation failed] ${request.url()}: ${request.failure()?.errorText || "unknown error"}`
		);
	});
	page.on("response", (response) => {
		if (
			!response.request().isNavigationRequest() ||
			response.status() < 400
		)
			return;

		report(
			`[browser navigation response] ${response.status()} ${response.url()}`
		);
	});
}
