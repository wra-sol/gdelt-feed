import type { LoaderFunctionArgs } from "react-router";
import { getLensWithWatches } from "~/services/lensDb";
import { getCoverageCached } from "~/services/coverageRead";
import { watchRef } from "~/services/watchEngine";
import { buildRssFeed, RSS_RESPONSE_INIT, type RssFeedItem } from "~/services/rssFeed";
import { seenToRfc822 } from "~/lib/date";
import { rssTokenOk } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";

/**
 * Public per-watch RSS — one watch's cached coverage (decision #8).
 * Cache-only like the per-lens feed: never fetches upstream.
 */
export async function loader({ params, request, context }: LoaderFunctionArgs) {
	const env = getCloudflare(context).env;
	const url = new URL(request.url);

	if (!rssTokenOk(env, url.searchParams.get("token"))) {
		return new Response("Forbidden", { status: 403 });
	}

	const db = env.DB;
	const found = await getLensWithWatches(db, params.slug!);
	if (!found) return new Response("Lens not found", { status: 404 });
	const { lens, watches } = found;

	const watch = watches.find((w) => w.id === params.watchId);
	if (!watch) return new Response("Watch not found", { status: 404 });

	const origin = url.origin;
	// Cache-only policy: getCoverageCached never fetches upstream.
	const ref = watchRef(watch);
	const cached = await getCoverageCached(db, ref);

	const items: RssFeedItem[] = cached.articles
		.filter((a) => a.url)
		.map((a) => ({
			title: a.title,
			link: a.url,
			description: `Source: ${a.domain ?? "unknown"} · ${ref.query}`,
			date: seenToRfc822(a.seendate),
		}));

	const xml = buildRssFeed(
		{
			title: `Meridian · ${lens.name} · ${watch.label}`,
			link: `${origin}/lens/${lens.slug}`,
			description:
				watch.label === lens.name
					? lens.description ?? `World press coverage of ${lens.name}`
					: `${watch.label} — world press coverage of ${lens.name}`,
		},
		items,
	);

	return new Response(xml, RSS_RESPONSE_INIT);
}
