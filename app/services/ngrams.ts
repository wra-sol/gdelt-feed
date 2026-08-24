/**
 * NGRAMS ingestion (decision: hybrid source, 2026-08-24).
 *
 * Every 15 minutes a Cron Trigger pulls GDELT's latest quadgram minute-file
 * pair (ngrams + TOC JSONL) from public GCS — no API, no rate limits — and
 * matches watch terms against the quadgram stream. Matched documents are
 * resolved via the TOC (url/title/image/lang) and stored in D1 as
 * throttle-proof secondary coverage with provenance.
 *
 * Feasibility measured on real files (2026-08-24): ~1.44M lines / ~8MB gz,
 * full multi-term scan ≈2.6s in Node; TOC ≈300KB gz JSONL. Fits the paid
 * Workers CPU budget; will NOT fit the free plan.
 */

import type { WatchDef } from "~/services/watchEngine";
import { compileNeedles, scanQuadgrams } from "~/services/ngramScan";

const NGRAMS_BASE =
	"https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams";

export interface NgramHit {
	watchId: string;
	url: string;
	title?: string;
	imageUrl?: string;
	lang?: string;
	publishedAt: string;
	matchedTerms: string[];
	sourceMinute: string;
}

interface TocEntry {
	ID: number;
	date: string;
	img?: string;
	lang?: string;
	title?: string;
	url?: string;
}

/** Newest available file has timestamp ≈ now−5min at minute ≡ 1 (mod 15). */
async function locateLatestMinute(): Promise<string | null> {
	for (let off = 5; off <= 45; off++) {
		const d = new Date(Date.now() - off * 60_000);
		if (d.getUTCMinutes() % 15 !== 1) continue;
		const ts = d.toISOString().replace(/[-:T]/g, "").slice(0, 12) + "00";
		const res = await fetch(`${NGRAMS_BASE}/${ts}.ngrams.txt.gz`, { method: "HEAD" });
		if (res.ok) return ts;
	}
	return null;
}

export async function ingestLatestMinute(
	db: D1Database,
	watches: { id: string; terms: string[] }[],
	opts: { enabled: boolean },
): Promise<{ minute: string | null; hits: number; docs: number }> {
	if (!opts.enabled || watches.length === 0) {
		return { minute: null, hits: 0, docs: 0 };
	}

	const minute = await locateLatestMinute();
	if (!minute) return { minute: null, hits: 0, docs: 0 };

	const compiled = compileNeedles(watches);
	const docTerms = new Map<string, Set<string>>(); // docId -> matched needles

	function mergeInto(src: Map<string, Set<string>>) {
		for (const [docId, terms] of src) {
			const cur = docTerms.get(docId);
			if (cur) {
				for (const t of terms) cur.add(t);
			} else {
				docTerms.set(docId, terms);
			}
		}
	}

	const ngramsRes = await fetch(`${NGRAMS_BASE}/${minute}.ngrams.txt.gz`);
	if (!ngramsRes.ok || !ngramsRes.body) throw new Error(`ngrams fetch ${ngramsRes.status}`);

	// Stream-decompress and scan complete lines per chunk; carry the trailing
	// partial line in the buffer so no quadgram is ever split across batches.
	const stream = ngramsRes.body.pipeThrough(new DecompressionStream("gzip"));
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let nl: number;
		const completeLines: string[] = [];
		while ((nl = buffer.indexOf("\n")) !== -1) {
			completeLines.push(buffer.slice(0, nl));
			buffer = buffer.slice(nl + 1);
		}
		if (completeLines.length > 0) mergeInto(scanQuadgrams(completeLines, compiled));
	}
	if (buffer) mergeInto(scanQuadgrams([buffer], compiled));

	if (docTerms.size === 0) return { minute, hits: 0, docs: 0 };

	// Resolve matched docs from TOC (JSONL)
	const tocRes = await fetch(`${NGRAMS_BASE}/${minute}.toc.json.gz`);
	if (!tocRes.ok || !tocRes.body) throw new Error(`toc fetch ${tocRes.status}`);
	const tocText = await new Response(
		tocRes.body.pipeThrough(new DecompressionStream("gzip")),
	).text();

	const tocById = new Map<string, TocEntry>();
	for (const line of tocText.split("\n")) {
		const l = line.trim();
		if (!l) continue;
		try {
			const entry = JSON.parse(l) as TocEntry;
			tocById.set(String(entry.ID), entry);
		} catch {
			// tolerate partial/odd lines
		}
	}

	let hits = 0;
	let docs = 0;
	const publishedAt = `${minute.slice(0, 4)}-${minute.slice(4, 6)}-${minute.slice(6, 8)}T${minute.slice(8, 10)}:${minute.slice(10, 12)}:00Z`;

	const stmt = db.prepare(
		`INSERT INTO ngram_articles (watch_id, url, title, image_url, lang, published_at, matched_terms, source_minute)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
		 ON CONFLICT (watch_id, url) DO NOTHING`,
	);

	const BATCH_SIZE = 50;
	let pending: D1PreparedStatement[] = [];
	async function flush() {
		if (pending.length === 0) return;
		await db.batch(pending);
		pending = [];
	}

	for (const [docId, terms] of docTerms) {
		const doc = tocById.get(docId);
		if (!doc?.url) continue;
		docs++;
		for (const c of compiled) {
			const matched = [...terms].filter((t) => c.needles.includes(t));
			if (matched.length === 0) continue;
			hits++;
			pending.push(
				stmt.bind(
					c.id,
					doc.url,
					doc.title ?? null,
					doc.img ?? null,
					doc.lang ?? null,
					publishedAt,
					JSON.stringify(matched),
					minute,
				),
			);
			if (pending.length >= BATCH_SIZE) await flush();
		}
	}
	await flush();

	return { minute, hits, docs };
}

/** Daily hit-count series per watch — Meridian's own accumulated baseline. */
export async function getNgramDailySeries(
	db: D1Database,
	watchIds: string[],
	days = 30,
): Promise<Map<string, { date: string; value: number }[]>> {
	const map = new Map<string, { date: string; value: number }[]>();
	if (watchIds.length === 0) return map;

	const placeholders = watchIds.map((_, i) => `?${i + 2}`).join(",");
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	const { results } = await db
		.prepare(
			`SELECT watch_id, substr(published_at, 1, 10) AS day, COUNT(*) AS hits
			 FROM ngram_articles
			 WHERE watch_id IN (${placeholders}) AND published_at >= ?1
			 GROUP BY watch_id, day ORDER BY day`,
		)
		.bind(since, ...watchIds)
		.all<{ watch_id: string; day: string; hits: number }>();

	for (const row of results) {
		if (!map.has(row.watch_id)) map.set(row.watch_id, []);
		map.get(row.watch_id)!.push({ date: row.day, value: row.hits });
	}
	return map;
}

/** Recent throttle-proof coverage for a set of watches (last 24h by default). */
export async function getRecentNgramHits(
	db: D1Database,
	watchIds: string[],
	hours = 24,
): Promise<
	{ watchId: string; url: string; title?: string; imageUrl?: string; lang?: string; publishedAt: string }[]
> {
	if (watchIds.length === 0) return [];
	const since = new Date(Date.now() - hours * 3600_000).toISOString();
	const placeholders = watchIds.map((_, i) => `?${i + 2}`).join(",");
	const { results } = await db
		.prepare(
			`SELECT watch_id, url, title, image_url, lang, published_at
			 FROM ngram_articles
			 WHERE watch_id IN (${placeholders}) AND published_at >= ?1
			 ORDER BY published_at DESC LIMIT 400`,
		)
		.bind(since, ...watchIds)
		.all<{ watch_id: string; url: string; title: string | null; image_url: string | null; lang: string | null; published_at: string }>();
	return results.map((r) => ({
		watchId: r.watch_id,
		url: r.url,
		title: r.title ?? undefined,
		imageUrl: r.image_url ?? undefined,
		lang: r.lang ?? undefined,
		publishedAt: r.published_at,
	}));
}
