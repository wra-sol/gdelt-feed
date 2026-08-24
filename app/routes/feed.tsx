import { useLoaderData, useNavigation, useSubmit, type LoaderFunctionArgs } from "react-router";
import type { GdeltMode, SortOrder } from "~/services/gdeltApi";
import type { Article } from "../types/gdelt";
import * as React from "react";
import {
    getColumns,
    addColumn,
    updateColumn,
    deleteColumn,
    type ColumnDefinition,
} from "../services/columnsDb";
import { Form, useRouteError, isRouteErrorResponse } from "react-router";
import { swr, revalidateCoverage } from "~/services/coverage";
import { formatSeenLocal } from "~/lib/date";
import { groupArticlesByTitle } from "~/lib/grouping";
import { COUNTRIES, flagEmoji } from "~/data/countries";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { writeGate } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";

const BY_NAME = new Map(
    COUNTRIES.filter((c) => c.iso2).map((c) => [c.name.toLowerCase(), c.iso2]),
);

function countryFlag(name?: string): string {
    return name ? flagEmoji(BY_NAME.get(name.toLowerCase())) : "";
}

interface ColumnData {
    definition: ColumnDefinition & { id: string };
    articles: Article[];
    stale: boolean;
    freshPromise?: Promise<{ articles: Article[]; stale: boolean }> | null;
}

interface LoaderData {
    columns: ColumnData[];
    lastUpdated: string;  // ISO timestamp
}

// Modify the action to handle both create, update, and delete
export const middleware = [writeGate];

export async function action({ request, context }: LoaderFunctionArgs) {
    const db = getCloudflare(context).env.DB;
    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    if (intent === "delete") {
        const id = formData.get("id")?.toString();
        if (id) {
            await deleteColumn(db, id);
        }
    } else if (intent === "create" || intent === "update") {
        const query = formData.get("query")?.toString() || "";
        const timespan = formData.get("timespan")?.toString();
        const mode = formData.get("mode")?.toString() as GdeltMode | undefined;
        const sort = formData.get("sort")?.toString() as SortOrder | undefined;
        const maxrecords = formData.get("maxrecords") ?
            parseInt(formData.get("maxrecords")?.toString() || "0", 10) : undefined;
        const id = formData.get("id")?.toString();

        if (query.length > 0) {
            if (intent === "update" && id) {
                await updateColumn(db, id, { query, timespan, mode, sort, maxrecords });
            } else {
                await addColumn(db, { query, timespan, mode, sort, maxrecords });
            }
        }
    }

    return null;
}

export async function loader({ request, context }: LoaderFunctionArgs): Promise<LoaderData> {
    const db = getCloudflare(context).env.DB;

    // Force-refresh (?refresh=true) bypasses TTL, so only honor it for Access-gated writers.
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "true";

    const colDefs = await getColumns(db);

    // Instant shell via SWR: D1-only reads paint immediately; stale columns
    // stream fresh coverage through Suspense (silent swap).
    const swrResults = await Promise.all(colDefs.map((def) => swr(db, def)));
    const columns: ColumnData[] = colDefs.map((def, i) => {
        const { immediate, fresh } = swrResults[i];
        return {
            definition: def,
            articles: immediate.articles,
            stale: immediate.stale && !fresh ? true : false,
            freshPromise: forceRefresh
                ? revalidateCoverage(db, def).then((c) => ({ articles: c.articles, stale: c.stale }))
                : fresh,
        };
    });

    return {
        columns,
        lastUpdated: new Date().toISOString()
    };
}

function ColumnSkeleton() {
    return (
        <div className="space-y-3 p-4" role="status" aria-label="Fetching latest articles">
            <p className="text-xs text-blue-300">Fetching latest coverage…</p>
            {[0, 1, 2].map((i) => (
                <div key={i} className="animate-pulse space-y-1.5 border-t border-gray-800 pt-3 first:border-0 first:pt-0">
                    <div className="h-3 w-full rounded bg-gray-800" />
                    <div className="h-2.5 w-2/3 rounded bg-gray-800" />
                </div>
            ))}
        </div>
    );
}

function ColumnArticles({ colData }: { colData: ColumnData }) {
    const fresh = colData.freshPromise ? React.use(colData.freshPromise) : null;
    const articles = fresh ? fresh.articles : colData.articles;
    const stale = (fresh ? fresh.stale : colData.stale) && !fresh;
    const groupedArticles = groupArticlesByTitle(articles);

    return (
        <>
            {articles.length === 0 ? (
                <div className="p-4">
                    <p className="text-sm text-gray-400">No articles matched this query{colData.definition.timespan ? ` in the last ${colData.definition.timespan}` : ""}.</p>
                    <p className="mt-1 text-xs text-gray-500">
                        Try a wider timespan, fewer words, or edit the query above.
                    </p>
                </div>
            ) : (
                <div className="space-y-6 p-4">
                    {groupedArticles.map(({ title, articles: grouped }) => {
                        const firstArticle = grouped[0];
                        const displayedArticles = grouped.slice(0, 3);
                        const totalCount = grouped.length;

                        return (
                            <div key={title} className="border-t border-gray-700 pt-4 first:border-t-0 first:pt-0">
                                <h3 className="font-medium mb-2">
                                    <a
                                        href={firstArticle.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:underline"
                                    >
                                        {title}
                                    </a>
                                </h3>

                                <div className="text-sm text-gray-400 mb-2 space-x-2">
                                    <span className="mr-2">
                                        {firstArticle.sourcecountry && countryFlag(firstArticle.sourcecountry) && (
                                            <span className="mr-1" title={firstArticle.sourcecountry}>
                                                {countryFlag(firstArticle.sourcecountry)}
                                            </span>
                                        )}
                                        {firstArticle.domain ?? "N/A"}
                                    </span>
                                    <span>
                                        {firstArticle.seendate && (
                                            formatSeenLocal(firstArticle.seendate) ?? firstArticle.seendate
                                        )}
                                    </span>
                                    {typeof firstArticle.tone === 'number' && (
                                        <span>Tone: {firstArticle.tone.toFixed(2)}</span>
                                    )}
                                </div>

                                <ul className="space-y-2 text-sm">
                                    {displayedArticles.map((article) => (
                                        <li key={article.url} className="flex items-center text-gray-400">
                                            <a
                                                href={article.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center mr-2 text-blue-300 hover:underline"
                                                title={`Open article from ${article.domain ?? "unknown source"}`}
                                            >
                                                {article.sourcecountry && countryFlag(article.sourcecountry) && (
                                                    <span className="mr-1" title={article.sourcecountry}>
                                                        {countryFlag(article.sourcecountry)}
                                                    </span>
                                                )}
                                                {article.domain ?? "View source"}
                                            </a>
                                        </li>
                                    ))}
                                </ul>

                                {totalCount > 3 && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        +{totalCount - 3} more source{totalCount - 3 > 1 ? 's' : ''}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {stale && (
                <p className="px-4 pb-3 text-xs text-yellow-600">
                    Cached view — live fetch throttled; will refresh automatically.
                </p>
            )}
        </>
    );
}

// Add this component for the countdown timer
function UpdateTimer({ lastUpdated }: { lastUpdated: string }) {
    return (
        <span className="text-sm text-gray-400">
            Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    const message = isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : error instanceof Error
            ? error.message
            : "Unexpected error";

    return (
        <div className="mx-auto max-w-3xl p-8">
            <div className="rounded border border-red-800 bg-gray-900 p-6 text-gray-300">
                <h1 className="mb-2 text-xl font-semibold text-red-300">Feed unavailable</h1>
                <p className="text-sm">{message}</p>
                <p className="mt-3 text-sm text-gray-500">
                    GDELT may be throttling or down — data refreshes every 15 minutes. Try again shortly.
                </p>
            </div>
        </div>
    );
}

export default function Feed() {
    const { columns, lastUpdated } = useLoaderData() as LoaderData;
    const navigation = useNavigation();
    const submit = useSubmit();
    const [deletingIds, setDeletingIds] = React.useState<Set<string>>(new Set());
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = React.useState<{ id: string; query: string } | null>(null);

    // Update refresh handler to force refresh
    const handleManualRefresh = () => {
        if (navigation.state === "idle") {
            submit({ refresh: 'true' }, { method: "get" });
        }
    };

    // Handle delete with optimistic update
    const handleDelete = (id: string) => {
        setDeletingIds(prev => new Set([...prev, id]));
        const formData = new FormData();
        formData.append("intent", "delete");
        formData.append("id", id.toString());
        submit(formData, { method: "post" });
        setPendingDelete(null);
    };

    // Filter out optimistically deleted columns
    const visibleColumns = columns.filter(col => !deletingIds.has(col.definition.id));

    // Reset deleting state when navigation completes
    React.useEffect(() => {
        if (navigation.state === "idle") {
            setDeletingIds(new Set());
        }
    }, [navigation.state]);

    // Determine if we're in a loading state
    const isLoading = navigation.state === "loading" || navigation.state === "submitting";

    return (
        <div className="mx-auto p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold text-blue-300">GDELT Feed</h1>
                    {isLoading && (
                        <span className="flex items-center gap-2 text-sm text-gray-400" role="status">
                            <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-300" aria-hidden></span>
                            Refreshing…
                        </span>
                    )}
                    {!isLoading && <UpdateTimer lastUpdated={lastUpdated} />}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleManualRefresh}
                        disabled={navigation.state !== "idle"}
                        aria-label="Refresh feeds"
                        className="inline-flex h-11 w-11 items-center justify-center bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setEditingId('new')}
                        aria-label="Add new feed"
                        className="inline-flex h-11 w-11 items-center justify-center bg-blue-600 text-white rounded hover:bg-blue-500"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>
            </div>

            {editingId === 'new' && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 mb-6">
                    <h2 className="text-xl font-semibold text-blue-300 mb-4">New Column</h2>
                    <Form method="post" className="space-y-4">
                        <input type="hidden" name="intent" value="create" />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-300">
                                    Query
                                    <input
                                        name="query"
                                        placeholder="e.g., climate change sourcelang:english"
                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-gray-300 placeholder-gray-500"
                                        required
                                    />
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300">
                                    Timespan
                                    <select
                                        name="timespan"
                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-3 py-2"
                                    >
                                        <option value="">All time</option>
                                        <option value="1d">Last 24 hours</option>
                                        <option value="7d">Last 7 days</option>
                                        <option value="1m">Last month</option>
                                        <option value="3m">Last 3 months</option>
                                    </select>
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300">
                                    Sort
                                    <select
                                        name="sort"
                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-3 py-2"
                                    >
                                        <option value="DateDesc">Newest first</option>
                                        <option value="DateAsc">Oldest first</option>
                                        <option value="ToneDesc">Most positive</option>
                                        <option value="ToneAsc">Most negative</option>
                                    </select>
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300">
                                    Max Records
                                    <input
                                        type="number"
                                        name="maxrecords"
                                        defaultValue={50}
                                        min="1"
                                        max="250"
                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-3 py-2"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-2 pt-4">
                            <button
                                type="submit"
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                            >
                                Create Column
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                            >
                                Cancel
                            </button>
                        </div>
                    </Form>
                </div>
            )}

            <div
                className="flex overflow-x-scroll transition-opacity"
                aria-busy={isLoading}
            >
                {visibleColumns.map((colData) => {
                    const { definition, articles } = colData;
                    const { id, query, timespan, mode, sort, maxrecords } = definition;
                    const isEditing = id === editingId;
                    const groupedArticles = groupArticlesByTitle(articles);

                        return (
                            <div key={id} className="border border-gray-700 rounded bg-gray-900 max-h-[80vh] overflow-y-scroll flex-shrink-0 flex-grow-0 w-[350px]">
                                <div className="sticky top-0 bg-gray-900/95 p-4 border-b border-gray-700">
                                    {isEditing ? (
                                        <Form method="post" className="space-y-3 mb-4">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={id} />

                                            <div>
                                                <label className="block text-sm font-medium text-gray-300">
                                                    Query
                                                    <input
                                                        name="query"
                                                        defaultValue={query}
                                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-2 py-1"
                                                        required
                                                    />
                                                </label>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-300">
                                                    Timespan
                                                    <select
                                                        name="timespan"
                                                        defaultValue={timespan}
                                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-2 py-1"
                                                    >
                                                        <option value="">All time</option>
                                                        <option value="1d">Last 24 hours</option>
                                                        <option value="7d">Last 7 days</option>
                                                        <option value="1m">Last month</option>
                                                        <option value="3m">Last 3 months</option>
                                                    </select>
                                                </label>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-300">
                                                    Sort
                                                    <select
                                                        name="sort"
                                                        defaultValue={sort}
                                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-2 py-1"
                                                    >
                                                        <option value="DateDesc">Newest first</option>
                                                        <option value="DateAsc">Oldest first</option>
                                                        <option value="ToneDesc">Most positive</option>
                                                        <option value="ToneAsc">Most negative</option>
                                                    </select>
                                                </label>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-300">
                                                    Max Records
                                                    <input
                                                        type="number"
                                                        name="maxrecords"
                                                        defaultValue={maxrecords}
                                                        min="1"
                                                        max="250"
                                                        className="mt-1 block w-full rounded border border-gray-600 bg-gray-800 px-2 py-1"
                                                    />
                                                </label>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    type="submit"
                                                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingId(null)}
                                                    className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </Form>
                                    ) : (
                                        <div className="flex justify-between items-start mb-3">
                                            <h2 className="text-xl font-semibold text-blue-300">
                                                {query}
                                            </h2>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setEditingId(id)}
                                                    className="text-sm text-gray-400 hover:text-white"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => setPendingDelete({ id, query })}
                                                    className="text-sm text-red-400 hover:text-red-300"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="text-sm text-gray-400 mb-3">
                                        {timespan && <span className="mr-2">Timespan: {timespan}</span>}
                                        {mode && <span className="mr-2">Mode: {mode}</span>}
                                        {sort && <span className="mr-2">Sort: {sort}</span>}
                                    </div>
                                </div>
                                <React.Suspense fallback={<ColumnSkeleton />}>
                                    <ColumnArticles colData={colData} />
                                </React.Suspense>
                            </div>
                        );
                    })}
                </div>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Delete column?"
                description={pendingDelete ? `This permanently removes “${pendingDelete.query}” and its saved coverage.` : undefined}
                confirmLabel="Delete column"
                cancelLabel="Keep it"
                onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
