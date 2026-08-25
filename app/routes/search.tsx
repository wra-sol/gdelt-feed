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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { SearchIcon, SearchXIcon, TimerOffIcon } from "lucide-react";
import { Link } from "react-router";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const SAMPLE_QUERIES = [
  '"climate change"',
  'inflation sourcelang:english',
  '"artificial intelligence"',
];

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
    <div className="mx-auto max-w-4xl p-4">
      <div className="rounded-xl border border-destructive/40 bg-card p-6 text-card-foreground" role="alert">
        <h1 className="mb-2 font-heading text-xl font-semibold text-destructive">Search unavailable</h1>
        <p className="text-sm">{message}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          GDELT may be throttling or down — try again in a few minutes.
        </p>
      </div>
    </div>
  );
}

/**
 * Hotlinked social images are mixed-quality and often dead (HANDOFF quirk).
 * Lazy-load; on failure degrade to the neutral placeholder instead of a
 * broken-image glyph.
 */
function ResultImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <div className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
        <span className="text-xs text-muted-foreground">No image</span>
      </div>
    );
  }
  return (
    <div className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export default function Search() {
  const { query, resultsPromise } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Search the world's press</h1>
      <p className="mt-1 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
        One English query · 65+ languages
      </p>

      <Form className="mt-5 mb-6 flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder='e.g. "climate change" sourcelang:english'
          className="sm:flex-1"
          minLength={3}
          required
        />
        <Button type="submit" pending={isLoading} pendingLabel="Searching…" size="touch">
          Search
        </Button>
      </Form>

      {resultsPromise ? (
        <React.Suspense fallback={<ResultsSkeleton />}>
          <SearchResults resultsPromise={resultsPromise} query={query} />
        </React.Suspense>
      ) : (
        <Empty className="mt-8 rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia>
              <SearchIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Start with a topic</EmptyTitle>
            <EmptyDescription>
              One English query matches machine-translated press across 65+
              languages. Results stream in as GDELT returns them.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap justify-center gap-2">
            {SAMPLE_QUERIES.map((q) => (
              <Link
                key={q}
                to={`/search?q=${encodeURIComponent(q)}`}
                prefetch="intent"
                className={cn(buttonVariants({ variant: "outline", size: "touch" }))}
              >
                {q}
              </Link>
            ))}
          </div>
        </Empty>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-32 w-32 flex-shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
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
        <p className="font-mono text-sm text-muted-foreground mb-4">
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
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              {hasImage ? (
                <ResultImage src={firstArticle.socialimage!} alt={firstArticle.title} />
              ) : (
                <div className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                  <span className="text-xs text-muted-foreground">No image</span>
                </div>
              )}

              <div className="flex-1">
                <h2 className="font-heading text-lg font-semibold leading-snug">
                  <a
                    href={firstArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                  >
                    {title}
                  </a>
                </h2>

                <div className="mt-1.5 mb-2 space-x-2 font-mono text-xs text-muted-foreground">
                  <span>{firstArticle.domain || "N/A"}</span>
                  {firstArticle.sourcecountry && (
                    <span>· {firstArticle.sourcecountry}</span>
                  )}
                  {firstArticle.seendate && (
                    <span>· {formatSeenUtc(firstArticle.seendate) ?? ""}</span>
                  )}
                  {typeof firstArticle.tone === 'number' && (
                    <span className={firstArticle.tone >= 0 ? "text-success" : "text-destructive"}>
                      · {firstArticle.tone > 0 ? "+" : ""}
                      {firstArticle.tone.toFixed(1)} tone
                    </span>
                  )}
                </div>

                <ul className="text-sm">
                  {displayedArticles.slice(1).map((art) => (
                    <li key={art.url} className="mb-1">
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                        title={`Open article from ${art.domain ?? "unknown source"}`}
                      >
                        {art.domain || "View source"}
                      </a>
                    </li>
                  ))}
                </ul>
                {totalCount > 5 && (
                  <p className="font-mono text-xs text-muted-foreground/70 mt-1">
                    +{totalCount - 5} more sources
                  </p>
                )}
              </div>
            </article>
          );
        })}
        {results.articles.length === 0 && (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia>
                {results.throttled ? <TimerOffIcon aria-hidden /> : <SearchXIcon aria-hidden />}
              </EmptyMedia>
              <EmptyTitle>
                {results.throttled
                  ? "GDELT is throttling right now"
                  : `No articles matched “${query}”`}
              </EmptyTitle>
              <EmptyDescription>
                {results.throttled
                  ? "The limit resets on its own — search again in a few minutes."
                  : "Try fewer words, drop operators, or widen the query — GDELT matches machine-translated text across 65 languages."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  );
}
