import {
  useLoaderData,
  useNavigation,
  Form,
  useSubmit,
  useSearchParams,
  useRouteError,
  isRouteErrorResponse,
  type LoaderFunctionArgs
} from "react-router";
import * as React from "react";
import type { Article } from '../types/gdelt';
import { GdeltApi } from "../services/gdeltApi";
import { groupArticlesByTitle } from "~/lib/grouping";
import { formatSeenLocal } from "~/lib/date";

interface LoaderData {
  articles: Article[];
  query: string;
  totalResults?: number;
  throttled?: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) {
    return { articles: [] as Article[], query: "", totalResults: undefined, throttled: false };
  }
  try {
    const results = await GdeltApi.searchArticles({ query });
    return {
      articles: results.articles,
      query,
      totalResults: results.totalResults,
      throttled: false,
    };
  } catch (error) {
    console.error("search fetch failed:", error);
    return { articles: [] as Article[], query, totalResults: undefined, throttled: true };
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unexpected error";

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="rounded border border-red-800 bg-gray-900 p-6 text-gray-300">
        <h1 className="mb-2 text-xl font-semibold text-red-300">Search unavailable</h1>
        <p className="text-sm">{message}</p>
        <p className="mt-3 text-sm text-gray-500">
          GDELT may be throttling or down — try again in a few minutes.
        </p>
      </div>
    </div>
  );
}

export default function Search() {
  const { articles, query, totalResults, throttled } = useLoaderData() as LoaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const isLoading = navigation.state === "loading";

  const groupedArticles = React.useMemo(
    () => groupArticlesByTitle(articles),
    [articles],
  );
  return (
    <div className="max-w-4xl mx-auto bg-gray-800 text-gray-200 p-4">
      <h1 className="text-2xl font-bold mb-4">Search News Articles</h1>
      
      <Form className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={searchParams.get("q") ?? ""}
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
                      Date: {formatSeenLocal(firstArticle.seendate) ?? ""}
                    </span>
                  )}
                  {typeof firstArticle.tone === 'number' && (
                    <span>Tone: {firstArticle.tone.toFixed(2)}</span>
                  )}
                </div>

                <ul className="text-sm text-gray-400 pl-4 list-disc">
                  {displayedArticles.map((art) => (
                    <li key={art.url} className="mb-2">
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:underline"
                        title={`Open article from ${art.domain ?? "unknown source"}`}
                      >
                        Source: {art.domain || "View source"}
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
          <div className="rounded border border-gray-700 bg-gray-900 p-4">
            {throttled ? (
              <>
                <p className="text-yellow-300">
                  GDELT is throttling requests right now.
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Search again in a few minutes — the limit resets on its own.
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-400">
                  No articles matched “{query}”{totalResults === 0 ? " in GDELT's index" : ""}.
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Try fewer words, drop operators, or widen the query — GDELT matches
                  machine-translated text across 65 languages.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
