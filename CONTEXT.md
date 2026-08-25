# CONTEXT.md — Meridian domain glossary

One concept, one word. Use these terms in code, UI copy, commits, and issues.
Deep background: [docs/adr-001-lens-model.md](docs/adr-001-lens-model.md), [HANDOFF.md](HANDOFF.md).

## Core nouns

| Term | Definition | Lives in |
|------|------------|----------|
| **Lens** | A place (country, province) as the subject: "world coverage OF Canada". The primary product object. Slugged (`canada`); has a FIPS code for flag/geo. | `lenses` table, `services/lensDb.ts`, route `/lens/:slug` |
| **Watch** | A structured topic subscription inside a lens: `{ terms[], geoTerms?, timespan?, sort?, maxrecords? }`. Compiled to a GDELT DOC query by the watch query compiler. Not free text — structured data by design (decision #11). | `watches` table, `services/watchEngine.ts` |
| **Watch query** | The compiled DOC 2.0 query string for a watch. Hard invariant: ≤1000 chars; violations fail loudly at write time and compile time — never clipped. | `watchEngine.compileWatchQuery` |
| **Watch View** | The count-honest per-watch render model: DOC coverage + ngram hits blended by title-group, `total` counting doc articles only, group cap applied once, ngram URLs badge-tagged. Pure and tested through its interface. | `services/watchView.ts` (`buildWatchView`, `watchRef`) |
| **Coverage** | "What is the current article set for this watch?" The one seam answering it: D1 cache → TTL policy → live GDELT fetch → throttle/outage degradation to stale cache → provenance. Callers never touch GDELT directly. | `services/coverage.ts` (SWR: `swr()`, `revalidateCoverage`) |
| **Stale-cache** | Degraded coverage source: upstream throttled/failed, serving the last known payload with `stale: true`. Surfaces must show the throttle state honestly. | `coverage.ts`, badges on lens cards |
| **Pulse** | Per-lens novelty header: what's new since *your* last visit (cookie-based baseline, no accounts). Pure math over coverage. | `lib/pulse.ts`, cookie helpers in `lib/lastSeen.ts` |
| **ngram stream / ngram hits** | Meridian's own accumulated secondary coverage: GDELT web-ngrams minute-files ingested by cron every 15 min into `ngram_articles`, matched per-watch against compiled needles. Throttle-proof; never inflates DOC totals (badge-tagged in UI). 90-day retention. | `services/ngrams.ts`, `services/ngramScan.ts`, cron in `workers/app.ts` |
| **Flagship lenses** | Curated launch lenses + watches seeded by migration (Canada, Ontario, Ukraine, India). Clone-and-edit is the intended path for new ones. | `migrations/0003_seed_flagships.sql` |
| **seendate** | GDELT's article timestamp format `yyyyMMddTHHmmssZ`. Parse/format only via `lib/date.ts`; SSR lists use hydration-safe UTC formatting. | `lib/date.ts` |

## Verbs / states

| Term | Meaning |
|------|---------|
| **Revalidate** | Live GDELT fetch that refreshes a watch's cached coverage. Single-flight per isolate; never throws — degrades to stale-cache. |
| **Stream (deferred)** | RR8 deferred loader data: instant cached shell paints, fresh coverage swaps in via Suspense. The core interaction pattern of every list surface. |
| **Gate (Access)** | Cloudflare Access JWT verification guarding mutations when enabled (RS256 via team JWKS + exp + aud; fail-closed). Dormant until edge app exists. RSS bypasses via tokened URLs (decision #12). |
| **Retired** | Removed legacy surfaces: `/feed` (columns UI, adopted into the demo lens by migration 0002) and stub routes. Don't resurrect; data flows through lenses now. |

## Non-goals (settled decisions)

No email infrastructure · no auth code (public reads / gated writes) · no article text ever (GDELT provides none — link out) · place-of-subject, not place-of-publisher · ship-and-show over usage metrics.
