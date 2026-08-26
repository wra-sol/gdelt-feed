import { getCachedArticles, cacheArticles, type CachedArticles } from "~/services/articleCache";
import { gdeltApi } from "~/services/gdeltApi";
import type { SortOrder } from "~/services/gdeltApi";
import type { Article } from "~/types/gdelt";
import { watchRef, type WatchDef, type WatchRef } from "~/services/watchEngine";

/**
 * The Coverage module — the one seam answering "what is the current coverage
 * for this Watch?" (architecture-review C1).
 *
 * Owns: TTL policy, upstream fetch + host failover, cache write, throttle/
 * outage degradation to stale cache, maxrecords clamping, provenance.
 * Callers (feed, lens pulse, trends, rss, cron) learn only this interface.
 */

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

/** One warm cycle — the cron cadence and GDELT's own index granularity. */
export const COVERAGE_WINDOW_MS = 15 * 60 * 1000;
/** Sustained-failure line: only ≥2 consecutive missed windows are degraded. */
const DEGRADE_AFTER_MS = 2 * COVERAGE_WINDOW_MS;

/**
 * The honesty rule (2026-08-25): a payload one window old is NOT degraded —
 * GDELT rolls its index every ~15 min anyway, so it sits within the same
 * data window a live query would read. Missing ONE cycle draws no banner;
 * background revalidation quietly retries. Missing ≥2 cycles means we can
 * no longer claim currency → stale.
 */
interface CachedRead {
	coverage: Coverage;
	refreshDue: boolean;
}

async function readCached(db: D1Database, watch: WatchRef): Promise<CachedRead> {
	const cached = await getCachedArticles(db, watch.id);
	if (!cached) {
		return {
			coverage: { articles: [], source: "stale-cache", fetchedAt: null, stale: true },
			refreshDue: true,
		};
	}
	const ageMs = Date.now() - new Date(cached.lastFetched ?? 0).getTime();
	return {
		coverage: {
			articles: cached.articles,
			source: ageMs < DEGRADE_AFTER_MS ? "cache" : "stale-cache",
			fetchedAt: cached.lastFetched ?? null,
			stale: ageMs >= DEGRADE_AFTER_MS,
		},
		refreshDue: !cached.isFresh,
	};
}

/** Instant: D1-only read. Returns even-stale payloads (check `stale`). */
export async function getCoverageCached(db: D1Database, watch: WatchRef): Promise<Coverage> {
	return (await readCached(db, watch)).coverage;
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
		const result = await gdeltApi.searchArticles({
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
		let cached: CachedArticles | null = null;
		try {
			cached = await getCachedArticles(db, watch.id);
		} catch (recoveryError) {
			console.error(`[coverage] ${watch.id} recovery read failed:`, recoveryError);
		}
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
	const { coverage: immediate, refreshDue } = await readCached(db, watch);
	const fresh = refreshDue ? revalidateCoverage(db, watch) : null;
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
