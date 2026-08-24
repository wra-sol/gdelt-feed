# ADR-001: Lenses are place-of-subject; Watches are structured data

Date: 2026-08-23 · Status: Accepted (decisions #3, #11)

## Context

GDELT's `sourcecountry` = where the publisher sits. Meridian lenses answer
"what is the world's press saying ABOUT X" — subject geography, not
publisher geography. DOC 2.0 has no article-level geo filter; GEO 2.0 has
`locationcc:`/`locationadm1:`/`near:` but only a 7-day window and an
intermittently-404ing endpoint.

## Decision

1. **Lens** = a place as *subject*: `{ slug, name, countryFips? }`.
2. **Watch** = a topic inside a lens, stored as structured data:
   `{ label, terms: string[], geoTerms?: string[], timespan?, sort?, maxrecords? }`.
3. The **watch engine compiles** a Watch into the best available query:
   - v1 (DOC-only): `(t1 OR t2) "Toponym1" "Toponym2"` — mentions-based,
     provenance labeled in UI.
   - later: GEO path behind feature flag; GKG ingestion for precision.
4. Article cache keys on `watch.id`; TTL 15 min shared across all visitors.
5. Legacy `/feed` columns remain working; migration adopts them into a
   default lens. Lens editing UX arrives with E3 UI.

## Consequences

- Users edit structured watches, never raw query strings — arbiters can be
  upgraded underneath without data migration.
- Empty results must read as coverage bias, not absence of events.
- `locationcc:` is rejected by DOC (verified live) — never send it there.
