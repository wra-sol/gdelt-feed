import { getCachedArticles, cacheArticles } from "~/services/articleCache";
import { GdeltApi } from "~/services/gdeltApi";
import type { SortOrder } from "~/services/gdeltApi";
import type { Article } from "~/types/gdelt";
import type { WatchDef } from "~/services/watchEngine";
import { watchRef } from "~/services/watchView";

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
 *
 * Single-flight per watch (per isolate): concurrent callers share one
 * in-flight fetch so N simultaneous visitors cannot multiply upstream
 * requests into GDELT's throttle.
 */
const inFlight = new Map<string, Promise<Coverage>>();

export function revalidateCoverage(db: D1Database, watch: WatchRef): Promise<Coverage> {
	const existing = inFlight.get(watch.id);
	if (existing) return existing;
	const promise = doRevalidateCoverage(db, watch).finally(() => inFlight.delete(watch.id));
	inFlight.set(watch.id, promise);
	return promise;
}

async function doRevalidateCoverage(db: D1Database, watch: WatchRef): Promise<Coverage> {
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

export interface CoverageWarmSummary {
	warmed: number;
	degraded: number;
	failed: number;
}

/**
 * Warm every Watch's Coverage on a schedule so visitors rarely trigger
 * upstream fetches themselves (throttle safety — the cron adapter runs this
 * sequentially; gdeltApi's upstream gate paces the loop automatically).
 *
 * Fault-isolated per Watch: `watchRef` compiles the Watch query and throws
 * loudly on poisoned rows (CONTEXT.md watch-query invariant) — one bad row
 * must skip one Watch, not starve every Watch after it. Callers pass the
 * Watch list; this module never reaches into storage aggregates.
 */
export async function warmAllCoverage(
	db: D1Database,
	watches: WatchDef[],
): Promise<CoverageWarmSummary> {
	const summary: CoverageWarmSummary = { warmed: 0, degraded: 0, failed: 0 };
	for (const watch of watches) {
		try {
			const coverage = await revalidateCoverage(db, watchRef(watch));
			if (coverage.stale) summary.degraded++;
			else summary.warmed++;
		} catch (error) {
			console.error(`[coverage] warm skipped ${watch.id}:`, error);
			summary.failed++;
		}
	}
	return summary;
}
