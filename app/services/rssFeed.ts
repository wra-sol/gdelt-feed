/**
 * The RSS feed serialization module — one home for escaping and RSS 2.0
 * channel/item templating. Callers own policy (what to include, provenance
 * wording, cache headers); this module owns the XML shape.
 *
 * Two adapters today: the per-lens feed and the per-watch feed.
 */

export interface RssChannel {
	title: string;
	link: string;
	description: string;
}

export interface RssFeedItem {
	title: string;
	link: string;
	description?: string;
	/** RFC-822 pubDate, already formatted by the caller. */
	date?: string;
}

export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function buildRssFeed(channel: RssChannel, items: RssFeedItem[]): string {
	const itemXml = items
		.slice(0, 100)
		.map(
			(i) => `\t\t<item>
\t\t\t<title>${esc(i.title)}</title>
\t\t\t<link>${esc(i.link)}</link>
${i.description ? `\t\t\t<description>${esc(i.description)}</description>\n` : ""}\t\t\t<guid>${esc(i.link)}</guid>
${i.date ? `\t\t\t<pubDate>${i.date}</pubDate>\n` : ""}\t\t</item>`,
		)
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
\t<channel>
\t\t<title>${esc(channel.title)}</title>
\t\t<link>${esc(channel.link)}</link>
\t\t<description>${esc(channel.description)}</description>
\t\t<generator>Meridian (Powered by GDELT Project API)</generator>
${itemXml}
\t</channel>
</rss>`;
}

export const RSS_RESPONSE_INIT: ResponseInit = {
	headers: {
		"Content-Type": "application/rss+xml; charset=utf-8",
		"Cache-Control": "public, max-age=900",
	},
};
