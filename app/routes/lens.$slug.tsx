import React from "react";
import {
	Form,
	Link,
	useLoaderData,
	useNavigation,
	useSubmit,
	type LoaderFunctionArgs,
} from "react-router";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import type { Article } from "~/types/gdelt";
import { swr } from "~/services/coverage";
import { isValidTimespan } from "~/services/gdeltApi";
import { getLensBySlug, getWatchesForLens, addWatch, deleteWatch } from "~/services/lensDb";
import { compileWatchQuery, type WatchDef } from "~/services/watchEngine";
import { getRecentNgramHits } from "~/services/ngrams";
import { groupArticlesByTitle, type ArticleGroup } from "~/lib/grouping";
	import { formatSeenUtc, groupKey, isoToSeenDate } from "~/lib/date";
import { computePulse } from "~/lib/pulse";
import { countryByFips, flagEmoji } from "~/data/countries";
import { writeGate } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";

/**
 * Per-watch view. docArticles is the DOC-coverage primary list — the ONLY
 * input to totals and pulse math. displayGroups is the rendering list:
 * doc groups with ngram-derived articles merged in (badge-tagged via
 * ngramUrls), so ngram hits never inflate counts.
 */
interface WatchView extends WatchDef {
	docArticles: Article[];
	displayGroups: ArticleGroup[];
	total: number;
	stale: boolean;
	ngramUrls: string[];
}

/** What a deferred fresh resolution delivers to the card body. */
interface FreshView {
	displayGroups: ArticleGroup[];
	total: number;
	stale: boolean;
	newCount: number;
	ngramUrls: string[];
}

function watchRef(watch: WatchDef) {
	return {
		id: watch.id,
		query: compileWatchQuery(watch),
		timespan: watch.timespan,
		sort: watch.sort,
		maxrecords: watch.maxrecords,
	};
}

type NgramHit = Awaited<ReturnType<typeof getRecentNgramHits>>[number];

/** Pure: DOC coverage + ngram hits → blended, count-honest view. */
function buildWatchView(
	watch: WatchDef,
	docArticles: Article[],
	hits: NgramHit[],
	stale: boolean,
): WatchView {
	const existingUrls = new Set(docArticles.map((a) => a.url));
	const ngramUrls = new Set<string>();
	const groups = groupArticlesByTitle([...docArticles]);
	const byKey = new Map(groups.map((g) => [groupKey({ title: g.title }), g]));

	for (const hit of hits) {
		if (existingUrls.has(hit.url)) continue;
		ngramUrls.add(hit.url);
		const pseudo: Article = {
			url: hit.url,
			title: hit.title ?? hit.url,
			socialimage: hit.imageUrl,
			seendate: isoToSeenDate(hit.publishedAt),
		};
		const g = byKey.get(groupKey(pseudo));
		if (g) g.articles.push(pseudo);
		else {
			const ng: ArticleGroup = { title: pseudo.title, articles: [pseudo] };
			groups.push(ng);
			byKey.set(groupKey(pseudo), ng);
		}
	}

	return {
		...watch,
		docArticles,
		displayGroups: groups.slice(0, 12),
		total: docArticles.length,
		stale,
		ngramUrls: [...ngramUrls],
	};
}

export const middleware = [writeGate];

export async function loader({ params, request, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const lens = await getLensBySlug(db, params.slug!);
	if (!lens) throw new Response("Lens not found", { status: 404 });

	const watches = await getWatchesForLens(db, lens.id);

	const cookieName = `m_seen_${lens.slug}`;
	const cookieMatch = request.headers.get("cookie")?.match(new RegExp(`${cookieName}=([^;]+)`));
	const lastSeenIso = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;

	const ngramHits = await getRecentNgramHits(db, watches.map((w) => w.id));
	const hitsByWatch = new Map<string, NgramHit[]>();
	for (const hit of ngramHits) {
		if (!hitsByWatch.has(hit.watchId)) hitsByWatch.set(hit.watchId, []);
		hitsByWatch.get(hit.watchId)!.push(hit);
	}

	// INSTANT SHELL: swr() reads D1 only. Live GDELT revalidation for stale
	// watches becomes a deferred promise — the page paints immediately and
	// fresher content silently swaps in via Suspense.
	const built = await Promise.all(
		watches.map(async (watch) => {
			const hits = hitsByWatch.get(watch.id) ?? [];
			const { immediate, fresh } = await swr(db, watchRef(watch));
			const view = buildWatchView(watch, immediate.articles, hits, immediate.stale);
			let freshPromise: Promise<FreshView> | null = null;
			if (fresh) {
				freshPromise = fresh.then((coverage) => {
					const fv = buildWatchView(
						watch,
						coverage.articles,
						hitsByWatch.get(watch.id) ?? [],
						coverage.stale,
					);
					const fp = computePulse(
						[{ id: watch.id, articles: fv.docArticles }],
						lastSeenIso,
					);
					return {
						displayGroups: fv.displayGroups.slice(0, 12),
						total: fv.total,
						stale: fv.stale,
						newCount: fp.perWatch[watch.id]?.newCount ?? 0,
						ngramUrls: fv.ngramUrls,
					};
				});
			}
			return { view, freshPromise };
		}),
	);

	const views = built.map((b) => b.view);
	const pulse = computePulse(
		views.map((v) => ({ id: v.id, articles: v.docArticles })),
		lastSeenIso,
	);

	return {
		lens: {
			id: lens.id,
			slug: lens.slug,
			name: lens.name,
			description: lens.description,
			flag: flagEmoji(countryByFips(lens.countryFips ?? "")?.iso2),
		},
		watches: built.map((b) => ({
			id: b.view.id,
			label: b.view.label,
			terms: b.view.terms,
			geoTerms: b.view.geoTerms ?? [],
			timespan: b.view.timespan,
			displayGroups: b.view.displayGroups,
			total: b.view.total,
			stale: b.view.stale,
			ngramUrls: b.view.ngramUrls,
			newCount: pulse.perWatch[b.view.id]?.newCount ?? 0,
			freshPromise: b.freshPromise,
		})),
		pulse: {
			watchCount: views.length,
			totalArticles: views.reduce((n, v) => n + v.total, 0),
			changedCount: pulse.changedCount,
			firstVisit: pulse.firstVisit,
			ngramCount: views.reduce((n, v) => n + v.ngramUrls.length, 0),
		},
	};
}

export async function action({ request, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const formData = await request.formData();
	const intent = formData.get("intent")?.toString();

	if (intent === "delete-watch") {
		await deleteWatch(db, formData.get("watchId")!.toString());
	} else if (intent === "add-watch") {
		const terms = formData
			.get("terms")!
			.toString()
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		if (terms.length === 0) return new Response("terms required", { status: 400 });
		const timespan = formData.get("timespan")?.toString() || undefined;
		if (timespan && !isValidTimespan(timespan)) {
			return new Response("invalid timespan", { status: 400 });
		}
		await addWatch(db, formData.get("lensId")!.toString(), {
			label: formData.get("label")!.toString() || terms[0],
			terms,
			timespan,
		});
	}

	return null;
}

type WatchData = Awaited<ReturnType<typeof loader>>["watches"][number];

function WatchList({ articles, ngramUrls }: { articles: ArticleGroup[]; ngramUrls: string[] }) {
	const ngramSet = new Set(ngramUrls);
	if (articles.length === 0) {
		return (
			<p className="text-sm text-gray-400">
				No coverage in this window — sparse results usually mean thin index coverage, not that
				nothing happened.
			</p>
		);
	}
	return (
		<>
			{articles.map(({ title, articles: grouped }) => {
				const first = grouped[0];
				const seenLabel = formatSeenUtc(first.seendate);
				return (
					<div key={title} className="border-t border-gray-800 pt-3 first:border-0 first:pt-0">
						<a
							href={first.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm font-medium text-blue-400 hover:underline"
						>
							{title}
						</a>
						<div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
							{ngramSet.has(first.url) && (
								<span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-300">
									ngram
								</span>
							)}
							<span>{first.domain ?? "N/A"}</span>
							{seenLabel && <span>{seenLabel}</span>}
							{typeof first.tone === "number" && (
								<span className={first.tone >= 0 ? "text-green-600" : "text-red-500"}>
									{first.tone.toFixed(1)}
								</span>
							)}
							{grouped.length > 1 && <span>+{grouped.length - 1} more</span>}
						</div>
					</div>
				);
			})}
		</>
	);
}

function WatchCard({
	watch,
	canEdit,
	onAskDelete,
}: {
	watch: WatchData;
	canEdit: boolean;
	onAskDelete: (w: { id: string; label: string }) => void;
}) {
	return (
		<div className="relative flex max-h-[80vh] w-[360px] flex-shrink-0 flex-grow-0 flex-col rounded border border-gray-700 bg-gray-900">
			<div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900/95 p-4">
				<div className="mb-1 flex items-start justify-between gap-2">
					<h3 className="font-semibold text-blue-300">{watch.label}</h3>
					{canEdit && (
						<button
							type="button"
							onClick={() => onAskDelete({ id: watch.id, label: watch.label })}
							className="text-red-400 hover:text-red-300"
						>
							Delete
						</button>
					)}
				</div>
				<div className="text-xs text-gray-500">
					{watch.timespan && <span className="mr-2">· {watch.timespan}</span>}
					{watch.geoTerms.length > 0 && (
						<span className="mr-2">· geo: {watch.geoTerms.join(", ")}</span>
					)}
					<span>· mentions-based</span>
				</div>
			</div>

			<React.Suspense
				fallback={
					<div className="space-y-3 p-4">
						<p className="text-xs text-blue-300" role="status">
							Fetching latest coverage…
						</p>
						{[0, 1, 2].map((i) => (
							<div key={i} className="animate-pulse space-y-1.5 border-t border-gray-800 pt-3 first:border-0 first:pt-0">
								<div className="h-3 w-full rounded bg-gray-800" />
								<div className="h-2.5 w-2/3 rounded bg-gray-800" />
							</div>
						))}
					</div>
				}
			>
				<CardResolved watch={watch} />
			</React.Suspense>
		</div>
	);
}

function CardResolved({ watch }: { watch: WatchData }) {
	const fresh = watch.freshPromise ? React.use(watch.freshPromise) : null;
	const groups = fresh?.displayGroups ?? watch.displayGroups;
	const total = fresh?.total ?? watch.total;
	const stale = fresh?.stale ?? watch.stale;
	const newCount = fresh?.newCount ?? watch.newCount;
	const ngramUrls = fresh?.ngramUrls ?? watch.ngramUrls;

	return (
		<>
			<div className="border-b border-gray-700 px-4 pb-2 pt-3 text-xs text-gray-500">
				{newCount > 0 && (
					<span className="mr-2 rounded-full bg-blue-600 px-2 py-0.5 font-semibold text-white">
						{newCount} new
					</span>
				)}
				<span className="mr-2">{total} articles</span>
				{stale && <span className="text-yellow-600">· stale (GDELT throttling)</span>}
			</div>
			<div className="space-y-4 overflow-y-auto p-4">
				<WatchList articles={groups} ngramUrls={ngramUrls} />
			</div>
		</>
	);
}

export default function LensPage() {
	const { lens, watches, pulse } = useLoaderData<typeof loader>();
	const navigation = useNavigation();
	const submit = useSubmit();
	const [showAdd, setShowAdd] = React.useState(false);
	const [pendingDelete, setPendingDelete] = React.useState<{ id: string; label: string } | null>(
		null,
	);

	// Mark this visit as "seen" after render so the next load can diff.
	React.useEffect(() => {
		document.cookie = `${"m_seen_" + lens.slug}=${encodeURIComponent(
			new Date().toISOString(),
		)}; path=/; max-age=2592000; samesite=lax`;
	}, [lens.slug]);

	return (
		<div className="mx-auto p-4">
			<div className="mb-4 flex items-center justify-between rounded border border-gray-700 bg-gray-900 p-4">
				<div>
					<h1 className="flex items-center gap-2 text-xl font-bold text-blue-300">
						{lens.flag && <span className="text-2xl">{lens.flag}</span>}
						{lens.name}
					</h1>
					{lens.description && <p className="mt-1 text-sm text-gray-400">{lens.description}</p>}
				</div>
				<div className="text-right text-sm text-gray-400">
					<p>
						<span className="text-lg font-semibold text-gray-200">{pulse.watchCount}</span>{" "}
						watches ·{" "}
						<span className="text-lg font-semibold text-gray-200">{pulse.totalArticles}</span>{" "}
						articles
					</p>
					<p className="mt-1">
						{pulse.firstVisit ? (
							<span className="text-gray-500">First visit — baseline recorded</span>
						) : pulse.changedCount > 0 ? (
							<span className="font-semibold text-blue-300">
								{pulse.changedCount} new since your last visit
							</span>
						) : (
							<span>No changes since your last visit</span>
						)}
						{pulse.ngramCount > 0 && (
							<span className="ml-2 text-gray-600">incl. {pulse.ngramCount} via ngram stream</span>
						)}
					</p>
				</div>
			</div>

			<div className="mb-4 flex items-center gap-2">
				<button
					onClick={() => setShowAdd((s) => !s)}
					disabled={navigation.state !== "idle"}
					className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
				>
					+ Add watch
				</button>
				<Link prefetch="intent" to={`/lens/${lens.slug}/trends`} className="text-sm text-blue-400 hover:text-blue-300">
					Trends →
				</Link>
				<Link prefetch="intent" to="/lenses" className="text-sm text-gray-400 hover:text-gray-300">
					All lenses →
				</Link>
			</div>

			{showAdd && (
				<Form method="post" className="mb-6 grid grid-cols-1 gap-3 rounded border border-gray-700 bg-gray-900 p-4 md:grid-cols-2">
					<input type="hidden" name="intent" value="add-watch" />
					<input type="hidden" name="lensId" value={lens.id} />
					<label className="text-sm text-gray-300 md:col-span-2">
						Label
						<input name="label" className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5" placeholder="e.g., Carbon policy" />
					</label>
					<label className="text-sm text-gray-300 md:col-span-2">
						Terms (comma-separated)
						<input name="terms" required className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5" placeholder='"carbon tax", emissions, Ottawa' />
					</label>
					<label className="text-sm text-gray-300">
						Timespan
						<select name="timespan" className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5">
							<option value="7d">7 days</option>
							<option value="14d">14 days</option>
							<option value="1m">1 month</option>
							<option value="3m">3 months</option>
						</select>
					</label>
					<div className="flex items-end">
						<button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500">
							Create watch
						</button>
					</div>
				</Form>
			)}

			{watches.length === 0 ? (
				<p className="text-gray-400">No watches in this lens yet.</p>
			) : (
				<div className="flex space-x-4 overflow-x-auto pb-4">
					{watches.map((w) => (
						<WatchCard key={w.id} watch={w} canEdit onAskDelete={setPendingDelete} />
					))}
				</div>
			)}

			<ConfirmDialog
				open={pendingDelete !== null}
				title="Delete watch?"
				description={pendingDelete ? `This removes “${pendingDelete.label}” and its saved coverage from this lens.` : undefined}
				confirmLabel="Delete watch"
				cancelLabel="Keep it"
				onConfirm={() => {
					if (!pendingDelete) return;
					const formData = new FormData();
					formData.append("intent", "delete-watch");
					formData.append("watchId", pendingDelete.id);
					submit(formData, { method: "post" });
					setPendingDelete(null);
				}}
				onCancel={() => setPendingDelete(null)}
			/>
		</div>
	);
}
