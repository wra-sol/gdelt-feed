import type { LoaderFunctionArgs } from "react-router";
import { getLensWithWatches } from "~/services/lensDb";
import { getCoverageCached } from "~/services/coverageRead";
import { watchRef } from "~/services/watchEngine";
import { buildRssFeed, RSS_RESPONSE_INIT, type RssFeedItem } from "~/services/rssFeed";
import { seenToRfc822 } from "~/lib/date";
import { rssTokenOk } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";

/**
 * Public per-lens RSS — merges every watch's cached coverage.
 * Serves from the shared D1 cache only (TTL-governed); RSS never triggers
 * upstream GDELT fetches, keeping the token budget for page renders.
 */
export async function loader({ params, request, context }: LoaderFunctionArgs) {
	const env = getCloudflare(context).env;
	const url = new URL(request.url);

	// Decision #12: RSS is public, but when the Access gate is on we require
	// the unguessable per-deployment token so readers can poll unauthenticated.
	if (!rssTokenOk(env, url.searchParams.get("token"))) {
		return new Response("Forbidden", { status: 403 });
	}

	const db = env.DB;
	const found = await getLensWithWatches(db, params.slug!);
	if (!found) return new Response("Lens not found", { status: 404 });
	const { lens, watches } = found;
	const origin = url.origin;

	// Cache-only policy: getCoverageCached never fetches upstream.
	const refs = watches.map(watchRef);
	const cachedLists = await Promise.all(
		refs.map((ref) => getCoverageCached(db, ref)),
	);

	const items = new Map<string, RssFeedItem>();
	for (const [i, watch] of watches.entries()) {
		for (const article of cachedLists[i]?.articles ?? []) {
			if (!article.url || items.has(article.url)) continue;
			items.set(article.url, {
				title: article.title,
				link: article.url,
				description: `Watch: ${watch.label} · Source: ${article.domain ?? "unknown"} · ${refs[i].query}`,
				date: seenToRfc822(article.seendate),
			});
		}
	}

	const xml = buildRssFeed(
		{
			title: `Meridian · ${lens.name}`,
			link: `${origin}/lens/${lens.slug}`,
			description: lens.description ?? `World press coverage of ${lens.name}`,
		},
		[...items.values()],
	);

	return new Response(xml, RSS_RESPONSE_INIT);
}
