import type { Article } from "~/types/gdelt";

export interface CachedArticles {
	articles: Article[];
	isFresh: boolean;
	/** Real instant of the upstream fetch that produced this payload. */
	lastFetched?: string;
}

const FRESH_MS = 15 * 60 * 1000;

export async function getCachedArticles(
	db: D1Database,
	columnId: string,
): Promise<CachedArticles | null> {
	const result = await db
		.prepare("SELECT articles, last_fetched FROM article_cache WHERE column_id = ?1")
		.bind(columnId)
		.first<{ articles: string; last_fetched: string }>();

	if (!result) return null;

	try {
		const isFresh = Date.now() - new Date(result.last_fetched).getTime() < FRESH_MS;
		const articles = JSON.parse(result.articles);

		if (!Array.isArray(articles)) {
			console.error("Parsed articles is not an array:", articles);
			return null;
		}

		return { articles, isFresh, lastFetched: result.last_fetched };
	} catch (error) {
		console.error("Error parsing cached articles:", error);
		return null;
	}
}

export async function cacheArticles(
	db: D1Database,
	columnId: string,
	articles: Article[],
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO article_cache (column_id, articles, last_fetched)
			 VALUES (?1, ?2, ?3)
			 ON CONFLICT (column_id) DO UPDATE SET
			   articles = ?2,
			   last_fetched = ?3`,
		)
		.bind(columnId, JSON.stringify(articles), new Date().toISOString())
		.run();
}

/** Statement form for composing atomic multi-table deletes via db.batch. */
export function deleteCachedStmt(db: D1Database, columnId: string): D1PreparedStatement {
	return db.prepare("DELETE FROM article_cache WHERE column_id = ?1").bind(columnId);
}
