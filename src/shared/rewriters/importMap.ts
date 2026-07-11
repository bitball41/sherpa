type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteSpecifierMap(
	map: unknown,
	rewrite: (url: string) => string
): void {
	if (!isRecord(map)) return;

	for (const key of Object.keys(map)) {
		const target = map[key];
		if (typeof target === "string") map[key] = rewrite(target);
	}
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

	rewriteSpecifierMap(map.imports, rewrite);

	if (isRecord(map.scopes)) {
		const scopes: JsonRecord = Object.create(null);
		for (const [scope, specifiers] of Object.entries(map.scopes)) {
			rewriteSpecifierMap(specifiers, rewrite);
			scopes[rewrite(scope)] = specifiers;
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
