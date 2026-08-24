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
import { formatSeenUtc } from "~/lib/date";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) {
    return { query: "", resultsPromise: null };
  }
  // Deferred: the form paints instantly; results stream in via Suspense.
  const resultsPromise = GdeltApi.searchArticles({ query })
    .then((results) => ({
      articles: results.articles,
      totalResults: results.totalResults,
      throttled: false,
    }))
    .catch((error) => {
      console.error("search fetch failed:", error);
      return { articles: [] as Article[], totalResults: undefined, throttled: true };
    });
  return { query, resultsPromise };
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
  const { query, resultsPromise } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  return (
    <div className="max-w-4xl mx-auto bg-gray-800 text-gray-200 p-4">
      <h1 className="text-2xl font-bold mb-4">Search News Articles</h1>
      
      <Form className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={query}
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

      {resultsPromise ? (
        <React.Suspense fallback={<ResultsSkeleton />}>
          <SearchResults resultsPromise={resultsPromise} query={query} />
        </React.Suspense>
      ) : null}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded border border-gray-700 bg-gray-900 p-4 flex gap-4">
          <div className="h-32 w-32 flex-shrink-0 rounded bg-gray-800" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-3/4 rounded bg-gray-800" />
            <div className="h-3 w-1/2 rounded bg-gray-800" />
            <div className="h-3 w-2/3 rounded bg-gray-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchResults({
  resultsPromise,
  query,
}: {
  resultsPromise: NonNullable<
    Awaited<ReturnType<typeof loader>>["resultsPromise"]
  >;
  query: string;
}) {
  const results = React.use(resultsPromise);
  const groupedArticles = groupArticlesByTitle(results.articles);

  return (
    <>
      {results.totalResults !== undefined && (
        <p className="text-sm text-gray-400 mb-4">
          Found {results.totalResults} results for "{query}"
        </p>
      )}

      <div className="space-y-4">
        {groupedArticles.map(({ title, articles: grouped }) => {
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
                      Date: {formatSeenUtc(firstArticle.seendate) ?? ""}
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
        {results.articles.length === 0 && (
          <div className="rounded border border-gray-700 bg-gray-900 p-4">
            {results.throttled ? (
              <>
                <p className="text-yellow-300">GDELT is throttling requests right now.</p>
                <p className="mt-1 text-sm text-gray-500">
                  Search again in a few minutes — the limit resets on its own.
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-400">
                  No articles matched “{query}”
                  {results.totalResults === 0 ? " in GDELT's index" : ""}.
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
    </>
  );
}
