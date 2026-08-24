CREATE TABLE IF NOT EXISTS lenses (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country_fips TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  lens_id TEXT NOT NULL REFERENCES lenses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  terms TEXT NOT NULL,
  geo_terms TEXT,
  timespan TEXT,
  sort TEXT DEFAULT 'DateDesc',
  maxrecords INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Adopt pre-lens columns into a default lens so nothing is lost.
INSERT INTO lenses (id, slug, name, description)
SELECT 'lens-default', 'demo', 'Demo Lens',
       'Columns that existed before lenses; adopt them into a real lens soon.'
WHERE NOT EXISTS (SELECT 1 FROM lenses WHERE id = 'lens-default');

INSERT INTO watches (id, lens_id, label, terms, timespan, sort, maxrecords)
SELECT 'w-' || c.id,
       'lens-default',
       substr(c.query, 1, 80),
       json_array(c.query),
       c.timespan,
       COALESCE(c.sort, 'DateDesc'),
       c.maxrecords
FROM columns c
WHERE NOT EXISTS (SELECT 1 FROM watches WHERE id = 'w-' || c.id);
