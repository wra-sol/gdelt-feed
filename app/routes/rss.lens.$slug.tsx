import type { LoaderFunctionArgs } from "react-router";
import { getLensWithWatches } from "~/services/lensDb";
import { getCoverageCached } from "~/services/coverage";
import { compileWatchQuery } from "~/services/watchEngine";
import { watchRef } from "~/services/watchView";
import { seenToRfc822 } from "~/lib/date";
import { rssTokenOk } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Public RSS for a lens — merges every watch's cached coverage.
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

	const items = new Map<string, { title: string; link: string; source: string; date?: string; watch: string }>();

	// Cache-only policy: getCoverageCached never fetches upstream.
	const cachedLists = await Promise.all(
		watches.map((watch) => getCoverageCached(db, watchRef(watch))),
	);
	for (const [i, watch] of watches.entries()) {
		const query = compileWatchQuery(watch);
		for (const article of cachedLists[i]?.articles ?? []) {
			if (!article.url || items.has(article.url)) continue;
			items.set(article.url, {
				title: article.title,
				link: article.url,
				source: `${article.domain ?? "unknown"} · ${query}`,
				date: seenToRfc822(article.seendate),
				watch: watch.label,
			});
		}
	}

	const itemXml = [...items.values()]
		.slice(0, 100)
		.map(
			(i) => `\t\t<item>
\t\t\t<title>${esc(i.title)}</title>
\t\t\t<link>${esc(i.link)}</link>
\t\t\t<description>Watch: ${esc(i.watch)} · Source: ${esc(i.source)}</description>
\t\t\t<guid>${esc(i.link)}</guid>
${i.date ? `\t\t\t<pubDate>${i.date}</pubDate>\n` : ""}\t\t</item>`,
		)
		.join("\n");

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
\t<channel>
\t\t<title>Meridian · ${esc(lens.name)}</title>
\t\t<link>${esc(`${origin}/lens/${lens.slug}`)}</link>
\t\t<description>${esc(lens.description ?? `World press coverage of ${lens.name}`)}</description>
\t\t<generator>Meridian (Powered by GDELT Project API)</generator>
${itemXml}
\t</channel>
</rss>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=900",
		},
	});
}
