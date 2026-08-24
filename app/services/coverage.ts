import { getCachedArticles, cacheArticles } from "~/services/articleCache";
import { GdeltApi } from "~/services/gdeltApi";
import type { SortOrder } from "~/services/gdeltApi";
import type { Article } from "~/types/gdelt";

/**
 * The Coverage module — the one seam answering "what is the current coverage
 * for this Watch?" (architecture-review C1).
 *
 * Owns: TTL policy, upstream fetch + host failover, cache write, throttle/
 * outage degradation to stale cache, maxrecords clamping, provenance.
 * Callers (feed, lens pulse, trends, rss, cron) learn only this interface.
 */

export interface WatchRef {
	/** Stable id — doubles as the article-cache key. */
	id: string;
	query: string;
	timespan?: string;
	sort?: SortOrder;
	maxrecords?: number;
}

export type CoverageSource = "cache" | "gdelt" | "stale-cache";

export interface Coverage {
	articles: Article[];
	/** cache = fresh TTL hit; gdelt = live fetch; stale-cache = degraded. */
	source: CoverageSource;
	/**
	 * When the payload was actually fetched (ISO). Fresh cache hits carry the
	 * real last_fetched instant, never "now". Null when unknown/degraded.
	 */
	fetchedAt: string | null;
	stale: boolean;
}

export async function getCoverage(
	db: D1Database,
	watch: WatchRef,
	opts: { forceRefresh?: boolean } = {},
): Promise<Coverage> {
	if (opts.forceRefresh) return revalidateCoverage(db, watch);
	const cached = await getCoverageCached(db, watch);
	return cached;
}

/** Instant: D1-only read. Returns even-stale payloads (check `stale`). */
export async function getCoverageCached(db: D1Database, watch: WatchRef): Promise<Coverage> {
	const cached = await getCachedArticles(db, watch.id);
	if (cached?.isFresh) {
		return {
			articles: cached.articles,
			source: "cache",
			fetchedAt: cached.lastFetched ?? null,
			stale: false,
		};
	}
	return {
		articles: cached?.articles ?? [],
		source: "stale-cache",
		fetchedAt: cached?.lastFetched ?? null,
		stale: true,
	};
}

/**
 * Live fetch + cache write. Never throws — degrades to the best known
 * cached state. This is the deferred half of stale-while-revalidate.
 */
export async function revalidateCoverage(db: D1Database, watch: WatchRef): Promise<Coverage> {
	const maxrecords = Math.min(Math.max(watch.maxrecords ?? 50, 1), 250);
	try {
		const result = await GdeltApi.searchArticles({
			query: watch.query,
			timespan: watch.timespan,
			sort: watch.sort,
			maxrecords,
		});
		await cacheArticles(db, watch.id, result.articles);
		return {
			articles: result.articles,
			source: "gdelt",
			fetchedAt: new Date().toISOString(),
			stale: false,
		};
	} catch (error) {
		console.error(`[coverage] ${watch.id} revalidation failed:`, error);
		const cached = await getCachedArticles(db, watch.id);
		return {
			articles: cached?.articles ?? [],
			source: "stale-cache",
			fetchedAt: cached?.lastFetched ?? null,
			stale: true,
		};
	}
}

/**
 * Stale-while-revalidate for streaming loaders:
 * instant cached view + a fresh-coverage promise, non-null only when the
 * cache was stale (nothing to stream on a fresh hit).
 */
export async function swr(
	db: D1Database,
	watch: WatchRef,
): Promise<{ immediate: Coverage; fresh: Promise<Coverage> | null }> {
	const immediate = await getCoverageCached(db, watch);
	const fresh = immediate.stale ? revalidateCoverage(db, watch) : null;
	return { immediate, fresh };
}
