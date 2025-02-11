import { 
  useLoaderData, 
  useNavigation, 
  Form, 
  useSubmit,
  useSearchParams,
  type LoaderFunctionArgs
} from "react-router";
import * as React from "react";
import type { Article } from '../types/gdelt';
import { GdeltApi } from "../services/gdeltApi";

interface LoaderData {
  articles: Article[];
  query: string;
  totalResults?: number;  
  timespan?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) {
    return { articles: [], query: "" };
  }
  const results = await GdeltApi.searchArticles({ query });
  return { articles: results.articles, query };
}

export default function Search() {
  const { articles, query, totalResults } = useLoaderData() as LoaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const isLoading = navigation.state === "loading";

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isFirstSearch = query === null;
    /* submit(e.currentTarget.form, {
      replace: !isFirstSearch,
    }); */
  };

  const groupedArticles = React.useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const article of articles) {
      const normalizedTitle = article.title.trim().toLowerCase();
      if (!map.has(normalizedTitle)) {
        map.set(normalizedTitle, []);
      }
      map.get(normalizedTitle)!.push(article);
    }
    return Array.from(map.entries()).map(([titleKey, group]) => ({
      title: group[0].title,
      articles: group
    }));
  }, [articles]);
  console.log(articles[0]);
  return (
    <div className="max-w-4xl mx-auto bg-gray-800 text-gray-200 p-4">
      <h1 className="text-2xl font-bold mb-4">Search News Articles</h1>
      
      <Form className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={searchParams.get("q") ?? ""}
          onChange={handleSearchChange}
          placeholder='Search news (e.g. "climate change" sourcelang:english)'
          className="w-full p-2 border border-gray-600 rounded bg-gray-700 
                     text-gray-200 placeholder-gray-400"
          minLength={3}
          required
        />
        <button 
          type="submit"
          disabled={isLoading}
          className="mt-2 px-4 py-2 bg-blue-400 text-white 
                     rounded hover:bg-blue-300 disabled:bg-blue-700"
        >
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </Form>

      {totalResults !== undefined && (
        <p className="text-sm text-gray-400 mb-4">
          Found {totalResults} results for "{query}"
        </p>
      )}

      <div className="space-y-4">
        {groupedArticles.length > 0 && groupedArticles.map(({ title, articles: grouped }) => {
          const firstArticle = grouped[0];
          const hasImage = Boolean(firstArticle.socialimage);
          const displayedArticles = grouped.slice(0, 5);
          const totalCount = grouped.length;
          
          return (
            <article 
              key={title} 
              className="p-4 border border-gray-700 rounded bg-gray-900 flex items-start gap-4"
            >
              {hasImage ? (
                <div className="w-32 h-32 flex-shrink-0">
                  <img
                    src={firstArticle.socialimage}
                    alt={firstArticle.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-32 h-32 flex-shrink-0 bg-gray-700 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">No Image</span>
                </div>
              )}

              <div className="flex-1">
                <h2 className="text-xl font-semibold mb-2">
                  <a
                    href={firstArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-300 hover:underline"
                  >
                    {title}
                  </a>
                </h2>

                <div className="text-sm text-gray-400 mb-2 space-x-2">
                  <span>Source: {firstArticle.domain || "N/A"}</span>
                  {firstArticle.sourcecountry && (
                    <span>Country: {firstArticle.sourcecountry}</span>
                  )}
                  {firstArticle.seendate && (
                    <span>
                      Date: {new Date(firstArticle.seendate.replace(
                        /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
                        '$1-$2-$3T$4:$5:$6Z'
                      )).toLocaleString()}
                    </span>
                  )}
                  {typeof firstArticle.tone === 'number' && (
                    <span>Tone: {firstArticle.tone.toFixed(2)}</span>
                  )}
                </div>

                <ul className="text-sm text-gray-400 pl-4 list-disc">
                  {displayedArticles.map((art) => (
                    <li key={art.url} className="mb-2">
                      <span className="mr-1">Source: {art.domain || "N/A"}</span>
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:underline"
                      >
                        (Link)
                      </a>
                    </li>
                  ))}
                </ul>
                {totalCount > 5 && (
                  <p className="text-sm text-gray-500 mt-1">
                    +{totalCount - 5} more link(s)
                  </p>
                )}
              </div>
            </article>
          );
        })}
        {articles.length === 0 && (
          <p className="text-gray-400">No articles found</p>
        )}
      </div>
    </div>
  );
}
