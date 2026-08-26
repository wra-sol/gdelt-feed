import { getCachedArticles } from "~/services/articleCache";
import type { WatchRef } from "~/services/watchEngine";
import type { Article } from "~/types/gdelt";

/**
 * The cache-only half of the Coverage module (architecture-review #3).
 *
 * This module is the safe read surface: it physically cannot trigger an
 * upstream fetch. Surfaces that must never touch GDELT (RSS pollers,
 * trends) import from here — the live half lives in `coverage.ts`
 * (swr / revalidateCoverage / warmAllCoverage) and nothing in this file
 * references it.
 *
 * The honesty rule lives here because it *is* the TTL policy: a payload
 * one warm window (15 min) old is NOT degraded — GDELT rolls its index
 * every ~15 min anyway, so it sits inside the same data window a live
 * query would read. Only ≥2 consecutive missed windows are stale;
 * background revalidation starts at the first (`refreshDue`).
 */

/** One warm cycle — the cron cadence and GDELT's own index granularity. */
export const COVERAGE_WINDOW_MS = 15 * 60 * 1000;
/** Sustained-failure line: only ≥2 consecutive missed windows are degraded. */
const DEGRADE_AFTER_MS = 2 * COVERAGE_WINDOW_MS;

export type CoverageSource = "cache" | "gdelt" | "stale-cache";

export interface Coverage {
	articles: Article[];
	/** cache = within the degrade window; gdelt = live fetch; stale-cache = degraded. */
	source: CoverageSource;
	/**
	 * When the payload was actually fetched (ISO). Fresh cache hits carry the
	 * real last_fetched instant, never "now". Null when unknown/degraded.
	 */
	fetchedAt: string | null;
	stale: boolean;
}

export interface CachedRead {
	coverage: Coverage;
	/** True when past the first window — SWR should kick off a revalidation. */
	refreshDue: boolean;
}

export async function readCached(db: D1Database, watch: WatchRef): Promise<CachedRead> {
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
