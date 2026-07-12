type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUrlLikeSpecifier(specifier: string): boolean {
	if (
		specifier.startsWith("/") ||
		specifier.startsWith("./") ||
		specifier.startsWith("../")
	) {
		return true;
	}

	// URL schemes are ASCII alpha followed by alpha/digit/+/-/. and a colon.
	// A colon elsewhere (for example `pkg/name:part`) does not make a bare
	// import-map specifier into a URL.
	return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier);
}

function rewriteSpecifierMap(
	map: unknown,
	rewrite: (url: string) => string
): unknown {
	if (!isRecord(map)) return map;

	const specifiers: JsonRecord = Object.create(null);
	for (const [key, target] of Object.entries(map)) {
		const rewrittenKey = isUrlLikeSpecifier(key) ? rewrite(key) : key;
		specifiers[rewrittenKey] =
			typeof target === "string" ? rewrite(target) : target;
	}

	return specifiers;
}

/**
 * Rewrites every URL-bearing part of an import map in place.
 *
 * `imports` and each scoped specifier map store URLs in their values. `scopes`
 * and `integrity` store URLs in their keys, so those objects are rebuilt with
 * null prototypes to handle user-controlled keys such as `__proto__` safely.
 */
export function rewriteImportMap(
	map: unknown,
	rewrite: (url: string) => string
): unknown {
	if (!isRecord(map)) return map;

	map.imports = rewriteSpecifierMap(map.imports, rewrite);

	if (isRecord(map.scopes)) {
		const scopes: JsonRecord = Object.create(null);
		for (const [scope, specifiers] of Object.entries(map.scopes)) {
			scopes[rewrite(scope)] = rewriteSpecifierMap(specifiers, rewrite);
		}
		map.scopes = scopes;
	}

	if (isRecord(map.integrity)) {
		const integrity: JsonRecord = Object.create(null);
		for (const [url, metadata] of Object.entries(map.integrity)) {
			integrity[rewrite(url)] = metadata;
		}
		map.integrity = integrity;
	}

	return map;
}
