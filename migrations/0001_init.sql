CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  timespan TEXT,
  mode TEXT,
  format TEXT,
  sort TEXT,
  maxrecords INTEGER
);

CREATE TABLE IF NOT EXISTS article_cache (
  column_id TEXT NOT NULL,
  articles TEXT NOT NULL,
  last_fetched TEXT NOT NULL,
  PRIMARY KEY (column_id)
);
