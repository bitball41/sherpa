import { Page } from "@playwright/test";

export function registerInspect(page: Page) {
	let hasOxcError = false;
	let hasSherpaError = false;
	page.on("console", async (msg) => {
		if (msg.type() === "error") {
			if (msg.text().includes("oxc parse error") && !hasOxcError) {
				hasOxcError = true;
				console.log("OXC parse error detected! Please review manually.");
			} else if (
				msg.text().includes("ERROR FROM SHERPA INTERNALS") &&
				!hasSherpaError
			) {
				hasSherpaError = true;
				console.log("Sherpa error detected! Please review manually.");
			}
		}
	});
}
