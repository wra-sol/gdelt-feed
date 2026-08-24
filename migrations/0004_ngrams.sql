CREATE TABLE IF NOT EXISTS ngram_articles (
  watch_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  image_url TEXT,
  lang TEXT,
  published_at TEXT NOT NULL,
  matched_terms TEXT,
  source_minute TEXT NOT NULL,
  PRIMARY KEY (watch_id, url)
);

CREATE INDEX IF NOT EXISTS idx_ngram_articles_watch_time
  ON ngram_articles (watch_id, published_at DESC);
