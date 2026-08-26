import type { Article } from "~/types/gdelt";
import type { WatchDef } from "~/services/watchEngine";
import { groupArticlesByTitle, groupKey, type ArticleGroup } from "~/lib/grouping";
import { isoToSeenDate } from "~/lib/date";
import { computePulse } from "~/lib/pulse";

/**
 * The Watch View module — turns a Watch's raw inputs into the count-honest
 * view every surface renders. Owns the blending order (DOC groups first,
 * ngram pseudo-articles merged by groupKey), the group cap (applied exactly
 * once, here), and Meridian's provenance invariant: ngram hits never inflate
 * DOC totals — `total` counts docArticles alone; ngram-derived URLs are
 * badge-tagged via `ngramUrls`.
 */

export interface NgramHit {
	watchId: string;
	url: string;
	title?: string;
	imageUrl?: string;
	lang?: string;
	publishedAt: string;
}

/** Per-watch blended view. docArticles is the ONLY input to totals. */
export interface WatchView extends WatchDef {
	docArticles: Article[];
	displayGroups: ArticleGroup[];
	total: number;
	stale: boolean;
	ngramUrls: string[];
}

/** What a deferred fresh coverage resolution delivers to the card body. */
export interface FreshView {
	displayGroups: ArticleGroup[];
	total: number;
	stale: boolean;
	newCount: number;
	ngramUrls: string[];
}

/**
 * The one builder for streamed freshness: Watch inputs → blended view →
 * per-watch new-count against the visitor's baseline. Single-homes the
 * FreshView shape so the live path and every degrade path produce
 * identical objects (architecture-review #6).
 */
export function buildFreshView(
	watch: WatchDef,
	docArticles: Article[],
	hits: NgramHit[],
	stale: boolean,
	lastSeenIso: string | null | undefined,
): FreshView {
	const fv = buildWatchView(watch, docArticles, hits, stale);
	const fp = computePulse([{ id: fv.id, articles: fv.docArticles }], lastSeenIso);
	return {
		displayGroups: fv.displayGroups,
		total: fv.total,
		stale: fv.stale,
		newCount: fp.perWatch[fv.id]?.newCount ?? 0,
		ngramUrls: fv.ngramUrls,
	};
}

const MAX_GROUPS = 12;

/** Pure: DOC coverage + ngram hits → blended, count-honest view. */
export function buildWatchView(
	watch: WatchDef,
	docArticles: Article[],
	hits: NgramHit[],
	stale: boolean,
): WatchView {
	const existingUrls = new Set(docArticles.map((a) => a.url));
	const ngramUrls = new Set<string>();
	const groups = groupArticlesByTitle([...docArticles]);
	const byKey = new Map(groups.map((g) => [groupKey({ title: g.title }), g]));

	for (const hit of hits) {
		if (existingUrls.has(hit.url)) continue;
		ngramUrls.add(hit.url);
		const pseudo: Article = {
			url: hit.url,
			title: hit.title ?? hit.url,
			socialimage: hit.imageUrl,
			seendate: isoToSeenDate(hit.publishedAt),
		};
		const g = byKey.get(groupKey(pseudo));
		if (g) g.articles.push(pseudo);
		else {
			const ng: ArticleGroup = { title: pseudo.title, articles: [pseudo] };
			groups.push(ng);
			byKey.set(groupKey(pseudo), ng);
		}
	}

	return {
		...watch,
		docArticles,
		displayGroups: groups.slice(0, MAX_GROUPS),
		total: docArticles.length,
		stale,
		ngramUrls: [...ngramUrls],
	};
}
