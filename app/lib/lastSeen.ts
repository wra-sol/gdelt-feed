/**
 * Per-lens "last seen" baseline — the cookie powering pulse novelty
 * (in-app pulse, no accounts). One home for the name, parse, and write.
 */
export const SEEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function seenCookieName(slug: string): string {
	return `m_seen_${slug}`;
}

/** Server-side read of the last-seen baseline from the request's cookies. */
export function seenCookieValue(request: Request, slug: string): string | null {
	const match = request.headers
		.get("cookie")
		?.match(new RegExp(`${seenCookieName(slug)}=([^;]+)`));
	return match ? decodeURIComponent(match[1]) : null;
}

/** Client-side write-back: record this instant as seen for the lens. */
export function seenCookieWrite(slug: string): string {
	return `${seenCookieName(slug)}=${encodeURIComponent(
		new Date().toISOString(),
	)}; path=/; max-age=${SEEN_COOKIE_MAX_AGE}; samesite=lax`;
}
