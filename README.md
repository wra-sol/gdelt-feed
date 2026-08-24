# Meridian (gdelt-feed)

> A region-first lens over the world's press — what's rising, how tone is moving, what changed. A radar, not a reader: we show you the signal; you click out to read.

Built on the [GDELT Project](https://www.gdeltproject.org/) DOC 2.0 API — free, keyless, 65+ languages, machine-translated into English queries.

**Status:** revival in progress — see [`HANDOFF.md`](./HANDOFF.md) for the full product plan and decision log.

## Stack

- React Router 7 (framework mode, SSR) + React 19 + Tailwind 4
- Cloudflare Workers + D1 (SQLite)
- No API keys; GDELT is fully public

## Development

```bash
npm install
npm run cf-typegen                              # regenerate worker types after wrangler.json changes
npx wrangler d1 migrations apply meridian-db --local
npm run dev                                     # vite dev with workerd runtime → http://localhost:5173
npm run typecheck                               # typegen + tsc -b (project references)
npm run build                                   # emits build/client + build/server
npm run check                                   # tsc + build + wrangler deploy --dry-run
```

## Deploy

```bash
npx wrangler login
npx wrangler d1 create meridian-db              # paste the id into wrangler.json
npx wrangler d1 migrations apply meridian-db --remote
npm run deploy                                  # build + wrangler deploy
```

Writes are gated by Cloudflare Access when the `ACCESS_GATE_ENABLED` var is `"true"`; reads and RSS stay public.

## Notes

- GDELT throttles aggressively (~1 req / 5 s, bursts cost minutes) — this app serves all visitors from a shared D1 cache with a 15-minute freshness window.
- GDELT never provides article text; headlines link out to publishers.
- Not affiliated with the GDELT Project. Data attribution: "Powered by GDELT Project API".

## License

MIT — see [LICENSE](./LICENSE).
