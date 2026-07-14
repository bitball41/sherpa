export const DEFAULT_REFERRER_POLICY: ReferrerPolicy =
	"strict-origin-when-cross-origin";

const REFERRER_POLICIES = new Set<ReferrerPolicy>([
	"no-referrer",
	"no-referrer-when-downgrade",
	"origin",
	"origin-when-cross-origin",
	"same-origin",
	"strict-origin",
	"strict-origin-when-cross-origin",
	"unsafe-url",
]);

/** Selects the last recognized policy from a Referrer-Policy header. */
export function selectReferrerPolicy(value: string): ReferrerPolicy | null {
	let selected: ReferrerPolicy | null = null;

	for (const rawToken of value.split(",")) {
		const token = rawToken.trim().toLowerCase() as ReferrerPolicy;
		if (REFERRER_POLICIES.has(token)) selected = token;
	}

	return selected;
}

function isDowngrade(source: URL, target: URL): boolean {
	return source.protocol === "https:" && target.protocol === "http:";
}

function stripReferrer(url: URL, originOnly = false): string {
	const stripped = new URL(url.href);
	stripped.username = "";
	stripped.password = "";
	stripped.hash = "";

	if (originOnly || stripped.href.length > 4096) {
		return `${stripped.origin}/`;
	}

	return stripped.href;
}

/** Applies a parsed policy to one outgoing Referer value. */
export function createReferrerValue(
	policy: ReferrerPolicy,
	source: URL,
	target: URL
): string | null {
	if (!["http:", "https:"].includes(source.protocol)) return null;

	const sameOrigin = source.origin === target.origin;
	const downgrade = isDowngrade(source, target);

	switch (policy) {
		case "no-referrer":
			return null;
		case "origin":
			return stripReferrer(source, true);
		case "unsafe-url":
			return stripReferrer(source);
		case "strict-origin":
			return downgrade ? null : stripReferrer(source, true);
		case "strict-origin-when-cross-origin":
			if (sameOrigin) return stripReferrer(source);

			return downgrade ? null : stripReferrer(source, true);
		case "same-origin":
			return sameOrigin ? stripReferrer(source) : null;
		case "origin-when-cross-origin":
			return stripReferrer(source, !sameOrigin);
		case "no-referrer-when-downgrade":
			return downgrade ? null : stripReferrer(source);
	}
}
