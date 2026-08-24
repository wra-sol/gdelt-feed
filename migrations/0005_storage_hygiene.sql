-- Hot read path: every /lens/:slug, RSS, and cron tick filters watches by
-- lens_id ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_watches_lens ON watches (lens_id, created_at);
