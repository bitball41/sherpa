/**
 * Web app manifests are the one *data* format the platform resolves URLs out
 * of. Sherpa passed them straight through, so every icon, screenshot and
 * shortcut in an installable site resolved against the proxy's own origin
 * instead of the site's - the manifest either 404'd its icons or, with
 * `start_url` pointing at the proxy root, offered an install that escaped the
 * proxy entirely.
 *
 * Members are per the Web App Manifest spec, plus the widely-shipped
 * `share_target`, `protocol_handlers` and `file_handlers` extensions. Unknown
 * members are left exactly as they are: a manifest is site data, and guessing
 * at which strings are URLs would corrupt it.
 *
 * Like `importMap.ts`, this takes the URL rewriter as a callback rather than
 * importing it, so it stays free of the WASM rewriter and can be tested on its
 * own.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Top-level members whose value is a single URL. */
const URL_MEMBERS = ["start_url", "scope"];

/** Top-level members holding an array of image resources (`{ src }`). */
const IMAGE_LIST_MEMBERS = ["icons", "screenshots"];

function rewriteMember(
	container: JsonRecord,
	member: string,
	rewrite: (url: string) => string
): void {
	const value = container[member];
	if (typeof value === "string") container[member] = rewrite(value);
}

function rewriteImageList(
	value: unknown,
	rewrite: (url: string) => string
): void {
	if (!Array.isArray(value)) return;

	for (const image of value) {
		if (isRecord(image)) rewriteMember(image, "src", rewrite);
	}
}

function rewriteEachMember(
	list: unknown,
	member: string,
	rewrite: (url: string) => string
): void {
	if (!Array.isArray(list)) return;

	for (const entry of list) {
		if (isRecord(entry)) rewriteMember(entry, member, rewrite);
	}
}

/** Rewrites every URL-valued member of a parsed manifest, in place. */
export function rewriteManifestObject(
	manifest: JsonRecord,
	rewrite: (url: string) => string
): void {
	for (const member of URL_MEMBERS) rewriteMember(manifest, member, rewrite);
	for (const member of IMAGE_LIST_MEMBERS)
		rewriteImageList(manifest[member], rewrite);

	if (Array.isArray(manifest["shortcuts"])) {
		for (const shortcut of manifest["shortcuts"]) {
			if (!isRecord(shortcut)) continue;
			rewriteMember(shortcut, "url", rewrite);
			rewriteImageList(shortcut["icons"], rewrite);
		}
	}

	rewriteEachMember(manifest["related_applications"], "url", rewrite);
	// `protocol_handlers` entries carry a `url` template; `file_handlers` and
	// `share_target` carry an `action`.
	rewriteEachMember(manifest["protocol_handlers"], "url", rewrite);
	rewriteEachMember(manifest["file_handlers"], "action", rewrite);

	if (isRecord(manifest["share_target"]))
		rewriteMember(manifest["share_target"], "action", rewrite);
}

/**
 * Rewrites a manifest response body. Anything that isn't a parseable JSON
 * object is handed back untouched - a broken manifest is the site's problem,
 * and replacing it with an error would be worse than passing it along.
 */
export function rewriteManifest(
	json: string,
	rewrite: (url: string) => string
): string {
	let manifest: unknown;
	try {
		manifest = JSON.parse(json);
	} catch {
		return json;
	}
	if (!isRecord(manifest)) return json;

	rewriteManifestObject(manifest, rewrite);

	return JSON.stringify(manifest);
}
