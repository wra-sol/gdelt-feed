import type { Article } from "~/types/gdelt";

/** GDELT seendate: yyyyMMddTHHmmssZ */
const SEEN_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export function parseSeenDate(seen?: string): Date | null {
	if (!seen) return null;
	const m = seen.match(SEEN_RE);
	if (!m) {
		const d = new Date(seen);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/**
 * Deterministic display string (server = client, no hydration mismatch):
 * "2026-08-24 13:05 UTC". Use this for SSR-rendered lists.
 */
export function formatSeenUtc(seen?: string): string | null {
	const d = parseSeenDate(seen);
	if (!d) return null;
	const iso = d.toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** RFC-822 pubDate for RSS, from a seendate value. */
export function seenToRfc822(seen?: string): string | undefined {
	const d = parseSeenDate(seen);
	return d ? d.toUTCString() : undefined;
}

/** Rebuild a seendate-shaped string from an ISO instant (ngram publishedAt → seendate). */
export function isoToSeenDate(iso: string): string | undefined {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return;
	return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function groupKey(article: Pick<Article, "title">): string {
	return article.title.trim().toLowerCase();
}
