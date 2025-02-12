import { useLoaderData, useNavigation, useSubmit, type LoaderFunctionArgs } from "react-router";
import { GdeltApi } from "../services/gdeltApi";
import type { GdeltFormat, GdeltMode, SortOrder } from "../services/gdeltApi";
import type { Article } from "../types/gdelt";
import * as React from "react";
import { getColumns, addColumn, initDb, updateColumn, deleteColumn } from "../services/columnsDb";
import { Form } from "react-router";
import { cacheArticles, getCachedArticles, initArticleCache } from "../services/articleCache";

interface ColumnDefinition {
    query: string;          // e.g. "climate change sourcelang:english"
    timespan?: string;      // e.g. "7d", "3m"
    mode?: GdeltMode;        // Changed from string to GdeltMode
    format?: GdeltFormat;   // e.g. "json", "html", etc.
    sort?: SortOrder;       // e.g. "ToneDesc"
    maxrecords?: number;    // e.g. 50, up to 250
}

interface ColumnData {
    definition: ColumnDefinition & { id: string };
    articles: Article[];
}

interface LoaderData {
    columns: ColumnData[];
    lastUpdated: string;  // ISO timestamp
}

// Modify the action to handle both create, update, and delete
export async function action({ request }: LoaderFunctionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    if (intent === "delete") {
        const id = formData.get("id")?.toString();
        if (id) {
            await deleteColumn(id);
        }
    } else if (intent === "create" || intent === "update") {
        const query = formData.get("query")?.toString() || "";
        const timespan = formData.get("timespan")?.toString();
        const mode = formData.get("mode")?.toString() as GdeltMode | undefined;
        const sort = formData.get("sort")?.toString() as SortOrder | undefined;
        const maxrecords = formData.get("maxrecords") ?
            parseInt(formData.get("maxrecords")?.toString() || "0", 10) : undefined;

        if (query.length > 0) {
            await addColumn({
                query,
                timespan,
                mode,
                sort,
                maxrecords,
            });
        }
    }

    return null;
}

export async function getArticlesForColumn(
    colDef: ColumnDefinition & { id: string },
    forceRefresh = false
): Promise<Article[]> {
    // Skip cache if force refresh
    if (!forceRefresh) {
        const cached = await getCachedArticles(colDef.id);
        if (cached?.isFresh) {
            return cached.articles;
        }
    }

    // Fetch new results
    const articles = await GdeltApi.searchArticles({
        query: colDef.query,
        mode: colDef.mode,
        timespan: colDef.timespan,
        sort: colDef.sort,
        maxrecords: colDef.maxrecords,
    });

    // Cache the new results
    await cacheArticles(colDef.id, articles.articles || []);

    return articles.articles || [];
}

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
    await initDb();
    await initArticleCache();

    // Check if this is a force refresh request
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    const colDefs = await getColumns();
    const columns: ColumnData[] = await Promise.all(colDefs.map(async (def) => ({
        definition: def,
        articles: await getArticlesForColumn(def, forceRefresh),
    })));

    return {
        columns,
        lastUpdated: new Date().toISOString()
    };
}

// Keep our custom flag emoji function which works well:
function getFlagEmoji(countryCode: string) {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// Add more country mappings to improve coverage:
function getCountryCode(countryName?: string): string | null {
    if (!countryName) return null;

    // Common country name mappings to ISO 3166-1 alpha-2 codes
    const countryMap: Record<string, string> = {
        'United States': 'US',
        'USA': 'US',
        'United Kingdom': 'GB',
        'UK': 'GB',
        'Russia': 'RU',
        'China': 'CN',
        'Japan': 'JP',
        'Germany': 'DE',
        'France': 'FR',
        'Italy': 'IT',
        'Spain': 'ES',
        'Canada': 'CA',
        'Australia': 'AU',
        'India': 'IN',
        'Brazil': 'BR',
        'Mexico': 'MX',
        'South Korea': 'KR',
        'Netherlands': 'NL',
        'Sweden': 'SE',
        'Norway': 'NO',
        'Denmark': 'DK',
        'Finland': 'FI',
        'Poland': 'PL',
        'Ireland': 'IE',
        'Switzerland': 'CH',
        'Austria': 'AT',
        'Belgium': 'BE',
        'Portugal': 'PT',
        'Greece': 'GR',
        'New Zealand': 'NZ',
        'Singapore': 'SG',
        'Israel': 'IL',
        'Turkey': 'TR',
        // Add more as needed
    };

    // Try direct mapping
    const code = countryMap[countryName];
    if (code) return code;

    // Try case-insensitive search
    const lowerName = countryName.toLowerCase();
    for (const [name, code] of Object.entries(countryMap)) {
        if (name.toLowerCase() === lowerName) return code;
    }

    // If the input is already a 2-letter code, validate and return it
    if (countryName.length === 2 && /^[A-Za-z]{2}$/.test(countryName)) {
        return countryName.toUpperCase();
    }

    return null;
}

// Add this component for the countdown timer
function UpdateTimer({ lastUpdated }: { lastUpdated: string }) {
    return (
        <span className="text-sm text-gray-400">
            Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
    );
}

export default function Feed() {
    const { columns, lastUpdated } = useLoaderData() as LoaderData;
    const navigation = useNavigation();
    const submit = useSubmit();
    const [deletingIds, setDeletingIds] = React.useState<Set<string>>(new Set());
    const [editingId, setEditingId] = React.useState<string | null>(null);

    // Update refresh handler to force refresh
    const handleManualRefresh = () => {
        if (navigation.state === "idle") {
            submit({ refresh: 'true' }, { method: "get" });
        }
    };

    // Handle delete with optimistic update
    const handleDelete = (id: string) => {
        if (window.confirm("Are you sure you want to delete this column?")) {
            setDeletingIds(prev => new Set([...prev, id]));
            const formData = new FormData();
            formData.append("intent", "delete");
            formData.append("id", id.toString());
            submit(formData, { method: "post" });
        }
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

    // Add grouping function
    const groupArticlesByTitle = React.useCallback((articles: Article[]) => {
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
    }, []);

    return (
        <div className="mx-auto p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold text-blue-300">GDELT Feed</h1>
                    <UpdateTimer lastUpdated={lastUpdated} />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleManualRefresh}
                        disabled={navigation.state !== "idle"}
                        className="p-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Refresh feeds"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setEditingId('new')}
                        className="p-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                        title="Add new feed"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

            {isLoading && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 text-gray-300">
                        <div className="flex items-center gap-3">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-300"></div>
                            Loading...
                        </div>
                    </div>
                </div>
            )}

            {!isLoading && (
                <div className="flex overflow-x-scroll">
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
                                                    onClick={() => handleDelete(id)}
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
                                {articles.length === 0 ? (
                                    <p className="text-sm text-gray-400">No articles found</p>
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
                                                            {firstArticle.sourcecountry && (
                                                                <span className="inline-flex items-center">
                                                                    {firstArticle.sourcecountry && getCountryCode(firstArticle.sourcecountry) && (
                                                                        <span className="mr-1" title={firstArticle.sourcecountry}>
                                                                            {getFlagEmoji(getCountryCode(firstArticle.sourcecountry)!)}
                                                                        </span>
                                                                    )}
                                                                    {firstArticle.domain ?? "N/A"}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span>
                                                            {firstArticle.seendate && new Date(firstArticle.seendate.replace(
                                                                /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
                                                                '$1-$2-$3T$4:$5:$6Z'
                                                            )).toLocaleString()}
                                                        </span>
                                                        {typeof firstArticle.tone === 'number' && (
                                                            <span>Tone: {firstArticle.tone.toFixed(2)}</span>
                                                        )}
                                                    </div>

                                                    <ul className="space-y-2 text-sm">
                                                        {displayedArticles.map((article) => (
                                                            <li key={article.url} className="flex items-center text-gray-400">
                                                                <span className="inline-flex items-center mr-2">
                                                                    {article.sourcecountry && getCountryCode(article.sourcecountry) && (
                                                                        <span className="mr-1" title={article.sourcecountry}>
                                                                            {getFlagEmoji(getCountryCode(article.sourcecountry)!)}
                                                                        </span>
                                                                    )}
                                                                    {article.domain ?? "N/A"}
                                                                </span>
                                                                <a
                                                                    href={article.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-blue-300 hover:underline"
                                                                >
                                                                    (Link)
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
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
} 