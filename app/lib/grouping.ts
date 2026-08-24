import type { Article } from "~/types/gdelt";

export interface ArticleGroup {
	title: string;
	articles: Article[];
}

/**
 * The one dedup/merge key for articles — grouping and ngram→group merging
 * must agree on it, so both go through here.
 */
export function groupKey(article: Pick<Article, "title">): string {
	return article.title.trim().toLowerCase();
}

/** Exact-normalized-title grouping (v0 dedup; clustering-v1 ticket pending). */
export function groupArticlesByTitle(articles: Article[]): ArticleGroup[] {
	const map = new Map<string, Article[]>();
	for (const article of articles) {
		const key = groupKey(article);
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(article);
	}
	return Array.from(map.entries()).map(([key, group]) => ({
		title: group[0].title,
		articles: group,
	}));
}
