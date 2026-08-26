import type { TimelinePoint } from "./timeline";

/**
 * Implementation annex of the Timeline module (services/timeline.ts) —
 * do not import reads/writes from here; cross the Timeline interface.
 * The only sanctioned external use is deleteTimelineStmt, so lensDb can
 * compose atomic multi-table deletes via db.batch.
 *
 * The SQL column is named `column_id` for migration-history reasons;
 * in this domain it holds a Watch id.
 */
export interface CachedPoints {
	points: TimelinePoint[];
	isFresh: boolean;
	/** Real instant of the upstream fetch that produced this payload. */
	lastFetched?: string;
}

const FRESH_MS = 15 * 60 * 1000;

export async function getCachedPoints(
	db: D1Database,
	watchId: string,
): Promise<CachedPoints | null> {
	const result = await db
		.prepare("SELECT points, last_fetched FROM timeline_cache WHERE column_id = ?1")
		.bind(watchId)
		.first<{ points: string; last_fetched: string }>();

	if (!result) return null;

	try {
		const isFresh = Date.now() - new Date(result.last_fetched).getTime() < FRESH_MS;
		const points = JSON.parse(result.points);

		if (!Array.isArray(points)) {
			console.error("Parsed timeline points is not an array:", points);
			return null;
		}

		return { points, isFresh, lastFetched: result.last_fetched };
	} catch (error) {
		console.error("Error parsing cached timeline points:", error);
		return null;
	}
}

export async function cachePoints(
	db: D1Database,
	watchId: string,
	points: TimelinePoint[],
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO timeline_cache (column_id, points, last_fetched)
			 VALUES (?1, ?2, ?3)
			 ON CONFLICT (column_id) DO UPDATE SET
			   points = ?2,
			   last_fetched = ?3`,
		)
		.bind(watchId, JSON.stringify(points), new Date().toISOString())
		.run();
}

/** Statement form for composing atomic multi-table deletes via db.batch. */
export function deleteTimelineStmt(db: D1Database, watchId: string): D1PreparedStatement {
	return db.prepare("DELETE FROM timeline_cache WHERE column_id = ?1").bind(watchId);
}
