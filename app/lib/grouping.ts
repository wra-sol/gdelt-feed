import type { Article } from "~/types/gdelt";

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

export function parseSeenDate(seen?: string): Date | null {
	if (!seen) return null;
	const normalized = seen.replace(
		/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
		"$1-$2-$3T$4:$5:$6Z",
	);
	const d = new Date(normalized);
	return Number.isNaN(d.getTime()) ? null : d;
}
