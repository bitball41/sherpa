const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isRedirectStatus(status: number): boolean {
	return REDIRECT_STATUSES.has(status);
}

export function isHtmlContentType(contentType: string | null): boolean {
	return contentType?.split(";", 1)[0].trim().toLowerCase() === "text/html";
}

export function normalizeHtmlContentType(contentType?: string): string {
	const value = contentType?.trim() || "text/html";
	const charset = /;\s*charset\s*=\s*(?:"[^"]*"|'[^']*'|[^;\s]*)/i;
	if (charset.test(value)) return value.replace(charset, "; charset=utf-8");

	return `${value}; charset=utf-8`;
}
