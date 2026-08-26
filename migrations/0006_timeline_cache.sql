-- Volume-intensity timelines per Watch, cached under the same window
-- policy as article_cache (see services/timeline.ts — the Timeline seam).
-- column_id = Watch id (house style; see 0001_init.sql).
CREATE TABLE IF NOT EXISTS timeline_cache (
	column_id TEXT NOT NULL,
	points TEXT NOT NULL,
	last_fetched TEXT NOT NULL,
	PRIMARY KEY (column_id)
);
