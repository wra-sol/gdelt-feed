# ADR-002: Search stays a direct upstream seam

Date: 2026-08-25 · Status: Accepted · Supersedes part of the #4 discussion in
the 2026-08-25 architecture review (`/tmp/architecture-review-20260825.html`).

## Context

CONTEXT.md names Coverage "the one seam" for upstream article data. Two other
surfaces touch GDELT directly:

1. **Trends** (`lens.$slug.trends.tsx`) fetched DOC volume timelines live on
   every visit.
2. **Search** (`search.tsx`) runs `searchArticles` on whatever query a visitor
   types.

The review flagged both as a possible violation of the Coverage seam.

## Decision

**Timelines join the windowed-cache policy** (ADR here recorded as done in
`services/timeline.ts` + `timeline_cache`, migration 0006): watch-keyed,
deterministic per watch, high reuse — exactly Coverage's shape. Cron warms
them alongside coverage; trends reads cache instantly and swaps fresh data
deferred under the same grace window as the lens page.

**Search stays direct**, by exemption:

- Queries are unbounded and visitor-authored — near-zero reuse, so a cache
  would almost always miss while adding staleness to a feature whose whole
  job is immediacy.
- The upstream gate (`upstreamGate.ts`) already paces and fast-fails these
  calls isolate-wide; single visitors cannot multiply into throttle damage.
- Failure mode is honest and local: the search route degrades to a branded
  "throttled, try later" panel.

## Consequences

- Any NEW watch-keyed, deterministic upstream read must join the
  window/cache policy (Coverage or Timeline), never bypass it.
- Search remains the one documented direct caller of `gdeltApi` outside the
  seams. If search ever gains saved/persistent queries, revisit this ADR —
  persistent queries are watches, and watches go through the seams.
