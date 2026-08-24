import type { Article } from "~/types/gdelt";
import { parseSeenDate } from "~/lib/date";

/**
 * The Pulse module — the Lens product's judgment (architecture-review C2).
 * Pure: given per-Watch coverage views and the visitor's last-seen instant,
 * produce everything the pulse header and watch badges display.
 */

export interface PulseWatchInput {
	id: string;
	articles: Article[];
}

export interface WatchPulse {
	newCount: number;
}

export interface LensPulse {
	firstVisit: boolean;
	changedCount: number;
	perWatch: Record<string, WatchPulse>;
}

export function computePulse(
	watches: PulseWatchInput[],
	lastSeenIso: string | null | undefined,
): LensPulse {
	const lastSeen = lastSeenIso ? parseSeenDate(lastSeenIso) : null;

	let changedCount = 0;
	const perWatch: Record<string, WatchPulse> = {};

	for (const watch of watches) {
		let newCount = 0;
		if (lastSeen) {
			for (const article of watch.articles) {
				const seen = parseSeenDate(article.seendate);
				if (seen && seen > lastSeen) newCount++;
			}
		}
		perWatch[watch.id] = { newCount };
		changedCount += newCount;
	}

	return { firstVisit: !lastSeen, changedCount, perWatch };
}
