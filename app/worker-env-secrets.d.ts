// Worker secrets aren't visible to `wrangler types` — declare them here.
// RSS_TOKEN: set via `npx wrangler secret put RSS_TOKEN`.
interface Env {
	RSS_TOKEN?: string;
}
