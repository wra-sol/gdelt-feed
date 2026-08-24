# Project Handoff: gdelt-feed → "Meridian"

## TL;DR

`wra-sol/gdelt-feed` is being revived into **Meridian** — a region-first *lens over the world's news*: pick a place, see what the global press is saying about it, watch tone/volume trends, get change alerts via pulse + RSS. Same free keyless GDELT APIs, restructured product.

**Decided architecture:** Cloudflare Workers SSR (RR8 Cloudflare adapter) + D1 storage replacing PGlite. Public reads, Access-gated writes, RSS unauthenticated. Repo cloned locally 2026-08-23; typecheck ✓ build ✓ (with red-flag findings below). Baseline verified; Epic 1 (infra revival) is next.

**Status:** Epic 0 complete except applying this doc. Roadmap §Roadmap. Decision log §Decisions. Do not deviate from decided architecture without updating the file.

## North star

> A radar, not a reader: GDELT never provides article text — Meridian shows pros (journalists, policy/NGO analysts, researchers) what's rising, how tone moves, and what changed in the places they watch, then links out. Success bar = ship-and-show: a polished public artifact (usage numbers are not the referee).

## Decisions (grill log, 2026-08-23)

| # | Topic | Decision |
|---|---|---|
| 1 | Ambition | Product seed — architecture keeps growth doors open |
| 2 | Wedge | Media monitoring × geopolitical signal × analytics = "the lens" |
| 3 | Organizing spine | Region-first; sharpened in deep-grill: lenses are **place-of-subject** ("world coverage OF Canada"), not place-of-publisher. Press-lens survives only as optional secondary view |
| 4 | User #1 persona | Pro watchers |
| 5 | Home screen | Lens-first pulse: "state of your places" |
| 6 | Old UI | Ship columns on Workers/D1 as-is → reshape into lenses after |
| 7 | Trend depth | DOC 3-month window for v1; schema designed so archive ingestion extends history later |
| 8 | Alerts | In-app pulse + per-watch/lens RSS; no email infra |
| 9→12 | Identity | No auth code. **Public reads / CF-Access-JWT writes**; RSS bypasses gate via unguessable tokened URLs |
| 10 | Success bar | Ship-and-show |
| 11 | Aboutness | Pipeline, not feature: `Watch` = structured data `{terms[], geo?, themes[]}` in D1; query compiler emits best-available arbiter (DOC toponyms → GEO 2.0 location filters → GKG later); curated flagship boolean blocks at launch; all clone-and-edit; provenance labeled |
| 14 | Scope floor | None pre-agreed, BUT **continuous-deploy discipline**: every epic merges deployable; partial completion still ships live artifact |
| 15 | Name | Product = **Meridian**; repo stays `gdelt-feed` |
| 16 | Ngrams (2026-08-24) | **Hybrid source**: DOC stays primary (tone!); GDELT web-ngrams minute-files ingested by Cron (`:06/:21/:36/:51`) into `ngram_articles` as throttle-proof secondary coverage + self-accumulating history. Context: GDELT's legacy Elasticsearch backend is being migrated to Spanner ("GDELT 5", announced 2026-04, ongoing) — throttles are transition pain; ngrams is their official interim off-ramp and keeps working regardless |

## What exists today (verified against HEAD `017c82b`)

React Router 7 framework mode + React 19 + Tailwind 4 + TypeScript. Working: `/` home, `/search`, `/feed` (multi-column GDELT queries: create/edit/delete/manual refresh, exact-title grouping, unicode flag emojis). Stubs: `/articles*`, `/visualizations*` ("coming soon"). Fixed dark palette; no theme toggle; manual refresh only (README overclaims — ignore README claims).

### Baseline verification (2026-08-23)

- `npm ci` ✓ · `npm run typecheck` ✓ clean · `npm run build` ✓ 4.4s
- **Build emits ONLY `build/client/`** — no server bundle (prerender-only mode).
- **`vite.config.ts` `outDir: 'dist'` is silently ignored** by the RR7 plugin. Dead config; it misled every prior deploy attempt (old `server.js` "wrong dir" theory was wrong — the dir was right; express was still static-only though).
- **Client bundle ships 12.9 MB of PGlite Postgres-WASM** (`postgres-*.wasm/.data`) because `feed.tsx` imports the PGlite services at module top-level. Perf disaster; dies with Epic 1.

## Architecture & stack (as-is)

- Routes in `app/routes.ts`; loaders/actions server-side (dev server only, effectively).
- `app/services/gdeltApi.ts` — typed DOC v2 client: validation (query 3–1000 chars, timespan regex, maxrecords ≤250), content-type guard, 429 surfacing. Defaults artlist/json/75/DateDesc.
- `app/services/columnsDb.ts` + `articleCache.ts` — PGlite `memory://` tables (columns keyed by MD5-of-query via **Node crypto**; articles cached 15-min freshness). All state evaporates per process. **Both replaced by D1 in Epic 1.**
- `columnsClient.ts` (localStorage) — dead code, imported nowhere. Delete E2.2.
- Dead weight (delete E2.2): `app/main.tsx`, `app/routes/search.error.tsx`, root `routes/*`, `index.html`; unused deps Radix×3/cva/lucide-react/country-flag-icons/@remix-run/router/postcss/autoprefixer; `components.json` with zero generated components.
- `openapi.yaml` = OpenAPI description of GDELT's own DOC API (upstream reference, not app spec). Its Article schema field names (`sourceCountry`,`publishDate`) do NOT match real API JSON (`sourcecountry`,`seendate`) — trust `app/types/gdelt.ts`.

## Repo map

```
gdelt-feed/
├── app/
│   ├── root.tsx, app.css, routes.ts
│   ├── main.tsx                      # DEAD
│   ├── routes/                       # layout, home, search(+error DEAD), feed(live),
│   │                                 # articles*/visualizations* (stubs)
│   ├── services/                     # gdeltApi(live), columnsDb+articleCache(→D1),
│   │                                 # columnsClient(DEAD)
│   └── types/gdelt.ts                # matches real API JSON
├── public/favicon.ico
├── routes/*, index.html              # DEAD scaffold
├── Dockerfile, server.js             # DELETE (Epic 1) — static-only, superseded
├── wrangler.toml                     # DELETE (Epic 1) — legacy Workers Sites
├── react-router.config.ts            # prerender:true → false (Epic 1)
├── vite.config.ts                    # outDir ignored; '~'→./app alias works
├── openapi.yaml                      # upstream GDELT reference
├── components.json                   # shadcn config, nothing generated
└── package.json                      # scripts to be rewritten for CF
```

## Run locally (today)

```bash
npm install && npm run dev        # http://localhost:5173 — full CRUD works while process lives
npm run typecheck && npm run build  # both green at baseline
```

## GDELT platform facts (live-probed + sourced 2026-08-23)

**API family (all keyless unless noted):**

| API | Base | Window | Notes |
|---|---|---|---|
| DOC 2.0 | `api.gdeltproject.org/api/v2/doc/doc` | 15min–3mo | Full-text over machine-translated 65 langs. Modes: artlist/timelinevol/tonechart/etc — **each mode returns different JSON shapes** (timelinevol = date/value arrays). No pagination; maxrecords ≤250. Supports domainis:, sourcelang:, sourcecountry:, near:, tone:/toneabs:, theme:(unverified live), image ops |
| GEO 2.0 | `/api/v2/geo/geo` | 15min–**7d** | Subject-geography: `locationcc:` `locationadm1:` `near:` operators; modes pointdata/adm1/country/sourcecountry (**tokens differ from DOC**, e.g. `pointdata`); formats GeoJSON/RSS/JSONFeed/CSV. **Endpoint intermittently 404s independent of DOC** (community-confirmed 2026-05) — never a hard dependency |
| TV 2.0 / Context | IA TV News / entity context | varies | Backlog |
| Web NGRAMS | `data.gdeltproject.org/gdeltv5/weblegacy/ngrams/<YYYYMMDDHHMM00>.{ngrams.txt.gz,toc.json.gz}` | 1-minute files, 15-min heartbeat (minute ≡ 1 mod 15) | Quadgram histograms + JSONL TOC (url/title/img/lang). ~8MB gz ngrams + ~300KB gz TOC per file. No tone. Keyless GCS — no rate limits. Ingester: `app/services/ngrams.ts` via scheduled handler; **requires Workers Paid** (measured 5.9s CPU/ingest in workerd) |

**Operational quirks (probed live):**
- **Throttle**: docs/community say ~1 req/5s and ~250/day/IP; observed cooldown after a 3-request burst ran **minutes, not seconds**. Design for: shared cache first (D1 TTL = one fetch serves all visitors), ≥6s spacing between upstream calls, exponential backoff on throttle text (it arrives as HTTP 200 plain text, not 429!).
- **Country codes are FIPS 10-4** (not ISO) across GDELT lookups; `sourcecountry` values arrive as name variants. Normalization table (FIPS↔ISO↔names) required for flags/slugs/picker.
- **No article text ever**; `seendate` = `yyyyMMddTHHmmssZ`; social images hotlinked/mixed-quality.
- **Coverage skews large/Western online outlets** — sparse small regions ≠ nothing happened (UX copy obligation).
- **Translingual superpower**: one English query matches translated local press — headline capability for regional lenses; lead with it in landing copy.
- Backup host `api-backup.gdeltproject.org` returned 301 on probe — failover value unproven; treat as best-effort.
- UA header: community-documented blocks on non-browser UAs — send browser-like UA from Workers.

## Decided deployment (replaces all legacy paths)

**Cloudflare Workers SSR** via RR8 Cloudflare adapter (`@react-router/cloudflare` + `@cloudflare/vite-plugin`, wrangler 4.x new-style config). `prerender: false`. Storage = **D1**: `lenses`, `watches`, `article_cache` (shared cross-visitor TTL cache), `ngram_articles` (90d retention, cron-pruned). wrangler.toml/Dockerfile/server.js deleted. Writes are gated by CF Access JWT (app-side verification: RS256 via team JWKS + exp + aud, fail-closed; dormant until ACCESS_GATE_ENABLED="true" + ACCESS_TEAM_DOMAIN/ACCESS_AUD set). Reads + RSS public. **RSS_TOKEN secret is set on the worker** (value in operator's local notes; regenerate via `npx wrangler secret put RSS_TOKEN`). Subrequest budget: cap watches/lens ≈20 (free tier = 50 subrequests/request).

Rejected alternatives (for the record): static Pages (breaks loaders/actions/search), node SSR react-router-serve (no server bundle even emitted today; hosting cost). Under Workers, GDELT sees CF egress either way — mitigated by shared D1 cache.

## Roadmap

Continuous-deploy rule: every epic ends mergeable + deployable. Sizing S<2h M≈½d L≈1d+.

**E0 — Groundwork ✅ DONE 2026-08-23**: clone, baseline green, operator spikes, doc staged (this file).

**E1 — Infra revival (Workers + D1)** ✅ DONE locally 2026-08-23 (deploy E1.9 pending CF auth)
- E1.1 Scaffold CF adapter + wrangler.json + workers/app.ts + entry.server.tsx + tsconfig trio ✅
- E1.2 `prerender`→`ssr:true` + `future.v8_viteEnvironmentApi` (flag renamed from unstable_ in 7.9.x) ✅
- E1.3 D1 migrations mirroring PGlite schemas (`migrations/0001_init.sql`) ✅ applied --local
- E1.4 columnsDb→D1; MD5→Web Crypto SHA-256 ✅
- E1.5 articleCache→D1 (15-min TTL shared) ✅
- E1.6 PGlite removed — client bundle 12.9MB → **420KB**; build now emits build/server too ✅
- E1.7 wrangler.toml/Dockerfile/server.js deleted; scripts rewritten (dev/build/preview/deploy/typecheck/cf-typegen/check) ✅
- E1.8 e2e: create column → row in D1 → full process restart → column renders ✅; GDELT 429 during e2e confirmed throttle-nukes-render gotcha → added stale-on-error fallback in getArticlesForColumn ✅
- E1.9 First deploy ✅ **2026-08-24 → https://meridian-news-lens.narfin.workers.dev** (personal CF acct `6b149553…`, set as `account_id` in wrangler.json; D1 `meridian-db` id `709d6028…`; 3 migrations applied --remote; smoke: / /lenses /lens/canada /rss 200; live GDELT articles rendered via CF egress on first hit — no throttle)
- E1.10 CI: .github/workflows/ci.yml (typecheck/build/dry-run) ✅

Version bumps during E1: react-router/@react-router/dev ^7.9.6 · vite ^7 · tailwindcss ^4.1.17 (4.0.x peer-blocks vite7) · @cloudflare/vite-plugin ^1.53 · wrangler ^4.125 · @types/node ^24 · @cloudflare/workers-types ^5. Removed: pglite, @react-router/node, @vitejs/plugin-react, autoprefixer, postcss.
New gotcha: under workers-types, `Response.json()` returns `unknown` (not any) — annotate parses.

**E2 — Harden & de-lie** ✅ DONE 2026-08-23
- E2.1 gdeltApi rewritten: browser UA, throttle-text detection (GdeltRateLimitError), AbortSignal timeouts, primary→backup host loop, fetchRaw/buildParams split for multi-mode use ✅
- E2.2 Pruned: main.tsx, search.error.tsx, routes/, index.html, columnsClient.ts, components.json; deps −9 (radix×3, cva, lucide-react, country-flag-icons, @remix-run/router, clsx, tailwind-merge, tailwindcss-animate); typography plugin now actually loaded via app.css `@plugin` ✅
- E2.3 README truth-pass (Meridian framing, CF deploy docs) ✅ · E2.4 LICENSE MIT ✅
- E2.5 Access gate: app/lib/access.ts (`isWriteAllowed`/`writeDenied`) wired into all mutation actions; edge policy still needs dashboard config at deploy ✅(code)
- E2.6 Friendly ErrorBoundary on /search and /feed ✅

**E3 — Lens shell + Watch Engine** ✅ DONE locally 2026-08-23
- E3.0 Spike ✅ DONE 2026-08-24 via prod egress probe (temp route, since removed): **DOC does NOT support `theme:`** ("too short/long/common" rejection class — same as locationcc; theme is GEO/GKG-family only). GEO endpoint 404s from CF egress too → currently down upstream globally; ADR degradation design validated. **Throttle hits even CF egress IPs intermittently (429 on ~half of 8s-spaced probes)** → shared D1 cache is load-bearing, not optional. Watch engine stays keywords+toponyms until GKG pipeline.
- E3.1 docs/adr-001-lens-model.md (Lens=place-of-subject, Watch=structured data) ✅
- E3.2 migration 0002: lenses/watches + auto-adoption of legacy columns into 'demo' lens ✅
- E3.3 watchEngine.compileWatchQuery v1 (DOC mentions path; GEO behind future flag per ADR) ✅
- E3.4 app/data/countries.ts generated from GDELT LOOKUP-COUNTRIES.TXT (274 FIPS entries, 63 ISO2 for flags) ✅
- E3.5 Lens pulse UI: header stats, per-watch new-since-last-visit badges, stale badges, honest empty-states ✅
- E3.6 Routes /lenses + /lens/:slug registered; legacy /feed untouched ✅

**E4 — Trends** ✅ DONE locally: services/timeline.ts (timelinevol lenient parser + averageTone), hand-rolled SVG TrendChart (no chart lib), /lens/:slug/trends page with within-window framing ✅

**E5 — Pulse + RSS** ✅ DONE locally: cookie-based last-seen diff in lens loader + client write-back; /rss/lens/:slug resource route serving cache-only RSS with Cache-Control 900s; token check against env.RSS_TOKEN when gate on ✅

**E6 — Ship-and-show**: landing page rewritten (Meridian mark inline SVG, capability cards, radar-not-reader copy, OG meta via meta export) ✅ · flagship seed migration 0003 (canada+ontario+ukraine+india, 7 curated watches w/ geo terms) ✅ applied --local · remaining: a11y/perf polish pass, custom domain, week-one throttle monitoring — post-deploy items ⏳

**Critical path:** E1 → E3 → E4 ∥ E5 → E6. Realistic total: 3–4 focused weekends.

## Gotchas (condensed — trust this over README)

1. Throttle arrives as HTTP-200 plain text, not 429; bursts cost minutes of cooldown. Shared D1 cache is the primary defense.
2. GEO endpoint flaky (404s) — always degrade to DOC path; never block render on GEO.
3. FIPS≠ISO; names vary — normalize once, early.
4. Mode-specific response shapes everywhere (DOC timelines, GEO feeds) — parse per-mode, type everything.
5. PGlite used to ship 12.9MB WASM to browsers — gone since E1.6; don't reintroduce client-side DB imports.
6. Empty/small-region results are coverage bias — copy accordingly.
7. openapi.yaml field names don't match live JSON; types/gdelt.ts does.
8. RSS URLs must work unauthenticated — keep them off the Access gate.
9. Keep GDELT attribution footer on every surface (ToS hygiene).
10. Watch queries are validated loud at write time (compileWatchQuery throws >1000 chars) — never reintroduce silent clipping.

## Verification checklist (next session)

- [ ] Apply this HANDOFF.md rewrite to repo root
- [ ] E1.8: create/edit/delete watch-column on `wrangler dev`; restart; data survives (D1 proof)
- [ ] Search works from cold URL on deployed worker (no dev server)
- [ ] Client bundle contains NO postgres wasm chunks after E1.6
- [ ] Throttle behavior: single fetch serves N simulated visitors (cache hit ratio logged)
- [ ] GEO-down simulation: lens renders via DOC fallback
- [ ] Unauthenticated visitor: can read lenses + RSS; mutation attempts blocked by Access
- [ ] LICENSE present; GitHub description/homepage = meridian branding when ready

## Architecture state (post review 2026-08-24)

Deep modules landed (commits a5a8a1b, 7b3f043): **Coverage** (`services/coverage.ts` — the one seam for cache→fetch→fallback; feed + lens consume it), **Pulse** (`lib/pulse.ts` — pure novelty computation), **ngramScan** (`services/ngramScan.ts` — pure quadgram matcher with token-edge boundaries + full provenance; ingest is thin I/O over it). Micro-modules single-sourced: `lib/date` (parse/format/rfc822), `lib/grouping`, `data/countries` flags. Vitest harness: `npm test`, 21 tests. Fixed en route: root ErrorBoundary prop bug, feed edit-duplicates-columns bug, RSS timing-safe compare, public refresh amplification gated.

**Not done (deliberate):** CONTEXT.md still absent — create when domain terms next crystallize. C5 legacy-columns retirement executed 2026-08-24 (`/feed` route + `columnsDb.ts` deleted; data lives on via migration 0002's auto-adoption into the `demo` lens). Remaining hazard: none known from the review strip.

## Ship state (2026-08-24)

- **Public**: pushed to GitHub `wra-sol/gdelt-feed`; repo description/homepage/topics set; CI green and now runs `npm test` (typecheck + test + build + wrangler dry-run).
- **Live**: https://meridian-news-lens.narfin.workers.dev — all surfaces 200; cron ingesting (~45 min-files/day) with 90d ngram retention.
- **UX audit** (external session): all six findings fixed in `7cd478c`.
- **Thermo-nuclear quality pass** (`946d11a` + follow-up): enforced the force-refresh gate (Access-JWT checked, no double-fetch), fixed the feed staleness flag so the throttle banner renders, single-flight SWR revalidation, atomic deletes (`db.batch`) with cache/ngram cleanup, real Access JWT verification (JWKS/exp/aud, fail-closed), whitelist-parsed DB/form unions, hydration-safe dates everywhere, dead deps/ui/config pruned for real. **C5 executed: `/feed` retired** — route, nav link, and `columnsDb.ts` deleted; legacy columns had already been auto-adopted into the `demo` lens by migration 0002.
- **Remaining manual step**: create the Cloudflare Zero-Trust Access application (dashboard — needs Access scopes we don't hold), then set `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` vars and `ACCESS_GATE_ENABLED="true"`. Until then all writes are open. RSS_TOKEN secret already set.

## Parked backlog

Real auth (on demand) · email digests · GKG/BigQuery archive ingestion (extends trends beyond 3mo; enables true aboutness precision) · GDELT Cloud eval (paid; events/entities/tone; history-from-2026-03 only) · multi-region home UX details · exact crisis/multilingual flagship picks.

## Links

Repo: https://github.com/wra-sol/gdelt-feed · GDELT: https://www.gdeltproject.org · DOC API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ · GEO API: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/ · Sibling revival handoff: `/home/nathaniel-arfin/Documents/project-revivals/yahooMcp/HANDOFF.md`
