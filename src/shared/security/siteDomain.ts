/** Whether a URL hostname is an IPv4 or bracketed IPv6 literal. */
export function isIpAddress(hostname: string): boolean {
	if (hostname.startsWith("[") && hostname.endsWith("]")) return true;

	const parts = hostname.split(".");

	return (
		parts.length === 4 &&
		parts.every(
			(part) =>
				/^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255
		)
	);
}
