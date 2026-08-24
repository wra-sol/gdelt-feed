import type { Article } from "~/types/gdelt";
import { parseSeenDate } from "~/lib/date";

export interface ArticleGroup {
	title: string;
	articles: Article[];
}

/** Exact-normalized-title grouping (v0 dedup; clustering-v1 ticket pending). */
export function groupArticlesByTitle(articles: Article[]): ArticleGroup[] {
	const map = new Map<string, Article[]>();
	for (const article of articles) {
		const key = article.title.trim().toLowerCase();
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(article);
	}
	return Array.from(map.entries()).map(([key, group]) => ({
		title: group[0].title,
		articles: group,
	}));
}

export { parseSeenDate };
