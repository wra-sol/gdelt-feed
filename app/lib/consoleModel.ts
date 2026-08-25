import { parseSeenDate } from "~/lib/date";

/**
 * The coverage console's state core — the pure rules behind the lens surface's
 * scan instrument. Node-testable by construction: no React, no storage, no DOM.
 * The component shell (components/coverageConsole.tsx) owns effects, keyboard,
 * and rendering; everything decidable without them lives here.
 */

/** Watch-order hue assignment — single home; chips and log rows share it. */
export const CHANNEL_HUES = ["#46e69b", "#59d8e6", "#ab90ff", "#ffb454", "#ff8fa3"];

export const FILTERS = ["ALL", "NEW", "NGRAM", "FLAGGED"] as const;
export type FilterView = (typeof FILTERS)[number];

/** FLAGGED view policy: tone at or below this reads as negative coverage. */
export const FLAGGED_TONE_THRESHOLD = -5;

/**
 * Display-only phosphor decay. "New" semantics are never derived from these —
 * newness is the device-local read flag (lib/triage).
 */
export const HOT_HOURS = 6;
export const WARM_HOURS = 24;

export type Tier = "hot" | "warm" | "old";

export function tierFor(seenTs: number | null, now: number): Tier {
	if (seenTs === null) return "old";
	const ageH = (now - seenTs) / 3600_000;
	return ageH < HOT_HOURS ? "hot" : ageH < WARM_HOURS ? "warm" : "old";
}

/** 1 = just seen, 0 = window expired. Clamped; null timestamps score 0. */
export function freshnessFraction(
	seenTs: number | null,
	now: number,
	windowHours: number,
): number {
	if (seenTs === null) return 0;
	const fraction = 1 - Math.max(0, now - seenTs) / (windowHours * 3600_000);
	return Math.max(0, Math.min(1, fraction));
}

export type Contact = {
	url: string;
	title: string;
	moreInGroup: number;
	domain?: string;
	seenTs: number | null;
	tone?: number;
	channel: number;
	channelLabel: string;
	ngram: boolean;
	read: boolean;
};

type ContactSource = {
	label: string;
	displayGroups: { title: string; articles: { url: string; title?: string; domain?: string; seendate?: string; tone?: number }[] }[];
	ngramUrls: string[];
};

/** Flatten resolved per-watch views into one recency-sorted contact list. */
export function buildContacts(sources: readonly ContactSource[], readSet: ReadonlySet<string>): Contact[] {
	const out: Contact[] = [];
	sources.forEach((source, channel) => {
		const ngramSet = new Set(source.ngramUrls);
		for (const group of source.displayGroups) {
			const article = group.articles[0];
			if (!article) continue;
			const seenDate = parseSeenDate(article.seendate);
			out.push({
				url: article.url,
				title: group.title,
				moreInGroup: group.articles.length - 1,
				domain: article.domain,
				seenTs: seenDate ? seenDate.getTime() : null,
				tone: article.tone,
				channel,
				channelLabel: source.label,
				ngram: ngramSet.has(article.url),
				read: readSet.has(article.url),
			});
		}
	});
	out.sort((a, b) => (b.seenTs ?? 0) - (a.seenTs ?? 0));
	return out;
}

export function matchesView(contact: Contact, view: FilterView): boolean {
	if (view === "NEW") return !contact.read;
	if (view === "NGRAM") return contact.ngram;
	if (view === "FLAGGED") return (contact.tone ?? 0) <= FLAGGED_TONE_THRESHOLD;
	return true;
}

export function applyView(contacts: readonly Contact[], view: FilterView): Contact[] {
	return contacts.filter((c) => matchesView(c, view));
}

/** The selection always names a row of the shown slice — this rule, enforced. */
export function clampSelection(selected: number, count: number): number {
	return Math.min(Math.max(0, selected), Math.max(0, count - 1));
}
