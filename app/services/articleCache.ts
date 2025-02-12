import { PGlite } from "@electric-sql/pglite";
import type { Article } from "~/types/gdelt";

let db: PGlite | null = null;

export async function initArticleCache() {
  if (!db) {
    db = new PGlite("memory://");
    await db.waitReady;

    await db.query(`
      CREATE TABLE IF NOT EXISTS article_cache (
        column_id TEXT NOT NULL,
        articles TEXT NOT NULL,
        last_fetched TIMESTAMP NOT NULL,
        PRIMARY KEY (column_id)
      )
    `);
  }
  return db;
}

export async function getCachedArticles(columnId: string): Promise<{ articles: Article[], isFresh: boolean } | null> {
  const database = await initArticleCache();
  const result = await database.query(
    `SELECT articles, last_fetched FROM article_cache WHERE column_id = $1`,
    [columnId]
  );

  if (result.rows.length === 0) return null;

  try {
    const { articles: articlesText, last_fetched } = result.rows[0] as { articles: string, last_fetched: string };
    const isFresh = (Date.now() - new Date(last_fetched).getTime()) < 15 * 60 * 1000;

    // Make sure we're parsing a string
    if (typeof articlesText !== 'string') {
      console.error('Cached articles is not a string:', articlesText);
      return null;
    }

    const articles = JSON.parse(articlesText);
    
    // Validate that we got an array
    if (!Array.isArray(articles)) {
      console.error('Parsed articles is not an array:', articles);
      return null;
    }

    return {
      articles,
      isFresh
    };
  } catch (error) {
    console.error('Error parsing cached articles:', error);
    return null;
  }
}

export async function cacheArticles(columnId: string, articles: Article[]): Promise<void> {
  const database = await initArticleCache();
  
  try {
    // Ensure we're storing a string
    const articlesText = JSON.stringify(articles);
    
    await database.query(
      `INSERT INTO article_cache (column_id, articles, last_fetched)
       VALUES ($1, $2, $3)
       ON CONFLICT (column_id) DO UPDATE SET
         articles = $2,
         last_fetched = $3`,
      [columnId, articlesText, new Date().toISOString()]
    );
  } catch (error) {
    console.error('Error caching articles:', error);
    throw error;
  }
} 