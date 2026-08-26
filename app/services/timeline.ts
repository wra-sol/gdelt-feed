import { gdeltApi } from "~/services/gdeltApi";
import { getCachedPoints, cachePoints, type CachedPoints } from "./timelineCache";
import { COVERAGE_WINDOW_MS } from "./coverageRead";

export interface TimelinePoint {
	date: string;
	value: number;
}

interface RawTimelineResponse {
	timeline?: {
		data?: {
			series?: string;
			values?: [string, string][];
		}[];
	}[];
}

/**
 * A Watch-shaped key for timeline reads: compiles to the same upstream query
 * family as Coverage but answers "how has volume moved?" instead of
 * "what is the current article set?".
 */
export interface TimelineKey {
	id: string;
	query: string;
	timespan?: string;
}

/** Pure: raw timelinevol payload → finite numeric points. Lenient by design. */
export function parseVolumeTimeline(raw: unknown): TimelinePoint[] {
	const series = (raw as Partial<RawTimelineResponse>)?.timeline?.[0]?.data?.[0]?.values;
	if (!Array.isArray(series)) return [];
	return series
		.map(([date, value]) => ({ date, value: Number(value) }))
		.filter((p) => Number.isFinite(p.value));
}

/**
 * The Timeline seam — the one place answering "how has volume moved for this
 * Watch?". Same policy vocabulary as Coverage (CONTEXT.md): D1 cache → one
 * warm window of grace → live GDELT fetch → degradation to stale cache with
 * provenance. Callers (trends, cron) never touch GDELT directly.
 *
 * Honesty rule shared with Coverage: a payload one window old is NOT stale —
 * GDELT rolls its index every ~15 min anyway. Only ≥2 missed windows earn
 * the degraded flag; background revalidation starts at the first.
 */
const DEGRADE_AFTER_MS = 2 * COVERAGE_WINDOW_MS;

export interface CachedTimeline {
	points: TimelinePoint[];
	fetchedAt: string | null;
	stale: boolean;
}

interface CachedRead {
	cached: CachedTimeline;
	refreshDue: boolean;
}

async function readCached(db: D1Database, key: TimelineKey): Promise<CachedRead> {
	const cached = await getCachedPoints(db, key.id);
	if (!cached) {
		return { cached: { points: [], fetchedAt: null, stale: true }, refreshDue: true };
	}
	const ageMs = Date.now() - new Date(cached.lastFetched ?? 0).getTime();
	return {
		cached: {
			points: cached.points,
			fetchedAt: cached.lastFetched ?? null,
			stale: ageMs >= DEGRADE_AFTER_MS,
		},
		refreshDue: !cached.isFresh,
	};
}

/** Instant: D1-only read. Returns even-stale payloads (check `stale`). */
export async function getTimelineCached(db: D1Database, key: TimelineKey): Promise<CachedTimeline> {
	return (await readCached(db, key)).cached;
}

/**
 * Live fetch + cache write. Never throws — degrades to the best known
 * cached state. Single-flight per watch (per isolate), mirroring Coverage.
 */
const inFlight = new Map<string, Promise<CachedTimeline>>();

export function revalidateTimeline(db: D1Database, key: TimelineKey): Promise<CachedTimeline> {
	const existing = inFlight.get(key.id);
	if (existing) return existing;
	const promise = doRevalidateTimeline(db, key).finally(() => inFlight.delete(key.id));
	inFlight.set(key.id, promise);
	return promise;
}

async function doRevalidateTimeline(db: D1Database, key: TimelineKey): Promise<CachedTimeline> {
	try {
		const raw = await gdeltApi.volumeTimeline(key.query, key.timespan ?? "3m");
		const points = parseVolumeTimeline(raw);
		await cachePoints(db, key.id, points);
		return { points, fetchedAt: new Date().toISOString(), stale: false };
	} catch (error) {
		console.error(`[timeline] ${key.id} revalidation failed:`, error);
		let recovered: CachedPoints | null = null;
		try {
			recovered = await getCachedPoints(db, key.id);
		} catch (recoveryError) {
			console.error(`[timeline] ${key.id} recovery read failed:`, recoveryError);
		}
		return {
			points: recovered?.points ?? [],
			fetchedAt: recovered?.lastFetched ?? null,
			stale: true,
		};
	}
}

/** Stale-while-revalidate for streamed loaders: instant cache + deferred fresh. */
export async function swrTimeline(
	db: D1Database,
	key: TimelineKey,
): Promise<{ immediate: CachedTimeline; fresh: Promise<CachedTimeline> | null }> {
	const { cached: immediate, refreshDue } = await readCached(db, key);
	const fresh = refreshDue ? revalidateTimeline(db, key) : null;
	return { immediate, fresh };
}

export interface TimelineWarmSummary {
	warmed: number;
	degraded: number;
	failed: number;
}

/** Warm every Watch's timeline on the cron schedule. Fault-isolated per Watch. */
export async function warmAllTimelines(
	db: D1Database,
	keys: TimelineKey[],
): Promise<TimelineWarmSummary> {
	const summary: TimelineWarmSummary = { warmed: 0, degraded: 0, failed: 0 };
	for (const key of keys) {
		try {
			const result = await revalidateTimeline(db, key);
			if (result.stale) summary.degraded++;
			else summary.warmed++;
		} catch (error) {
			console.error(`[timeline] warm skipped ${key.id}:`, error);
			summary.failed++;
		}
	}
	return summary;
}

/** Average article tone across a set of articles (-100..+100 scale, typically ±15). */
export function averageTone(articles: { tone?: number }[]): number | null {
	const tones = articles.map((a) => a.tone).filter((t): t is number => typeof t === "number");
	if (tones.length === 0) return null;
	return tones.reduce((a, b) => a + b) / tones.length;
}
