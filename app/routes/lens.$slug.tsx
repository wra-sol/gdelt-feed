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
import { getCoverage } from "~/services/coverage";
import { getLensBySlug, getWatchesForLens, addWatch, deleteWatch } from "~/services/lensDb";
import { compileWatchQuery, type WatchDef } from "~/services/watchEngine";
import { getRecentNgramHits } from "~/services/ngrams";
import { groupArticlesByTitle, type ArticleGroup } from "~/lib/grouping";
import { formatSeenLocal, groupKey, isoToSeenDate } from "~/lib/date";
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
}

export const middleware = [writeGate];

export async function loader({ params, request, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const lens = await getLensBySlug(db, params.slug!);
	if (!lens) throw new Response("Lens not found", { status: 404 });

	const watches = await getWatchesForLens(db, lens.id);

	// C1: the Coverage seam owns cache/fetch/failover per watch.
	const views: WatchView[] = await Promise.all(
		watches.map(async (watch) => {
			const coverage = await getCoverage(
				db,
				{
					id: watch.id,
					query: compileWatchQuery(watch),
					timespan: watch.timespan,
					sort: watch.sort,
					maxrecords: Math.min(watch.maxrecords ?? 50, 250),
				},
				{ forceRefresh: false },
			);
			return {
				...watch,
				docArticles: coverage.articles,
				displayGroups: groupArticlesByTitle([...coverage.articles]),
				total: coverage.articles.length,
				stale: coverage.stale,
			};
		}),
	);

	// C2: pulse math runs on DOC coverage only, never the blended display list.
	const cookieName = `m_seen_${lens.slug}`;
	const cookieMatch = request.headers.get("cookie")?.match(new RegExp(`${cookieName}=([^;]+)`));
	const lastSeenIso = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
	const pulse = computePulse(
		views.map((v) => ({ id: v.id, articles: v.docArticles })),
		lastSeenIso,
	);

	// Blend ngram-derived coverage into DISPLAY groups only (throttle-proof
	// secondary source): deduped against doc urls, seendate rebuilt via
	// isoToSeenDate, appended into a matching title group or as its own entry.
	const ngramHits = await getRecentNgramHits(db, views.map((v) => v.id));
	const hitsByWatch = new Map<string, typeof ngramHits>();
	for (const hit of ngramHits) {
		if (!hitsByWatch.has(hit.watchId)) hitsByWatch.set(hit.watchId, []);
		hitsByWatch.get(hit.watchId)!.push(hit);
	}
	const ngramUrls = new Set<string>();
	for (const view of views) {
		const docUrls = new Set(view.docArticles.map((a) => a.url));
		for (const hit of hitsByWatch.get(view.id) ?? []) {
			if (docUrls.has(hit.url)) continue;
			ngramUrls.add(hit.url);
			const article: Article = {
				url: hit.url,
				title: hit.title ?? hit.url,
				socialimage: hit.imageUrl,
				seendate: isoToSeenDate(hit.publishedAt),
			};
			const key = groupKey(article);
			const match = view.displayGroups.find((g) => groupKey(g) === key);
			if (match) match.articles.push(article);
			else view.displayGroups.push({ title: article.title, articles: [article] });
		}
	}

	return {
		lens: {
			id: lens.id,
			slug: lens.slug,
			name: lens.name,
			description: lens.description,
			flag: flagEmoji(countryByFips(lens.countryFips ?? "")?.iso2),
		},
		watches: views.map((v) => ({
			id: v.id,
			label: v.label,
			terms: v.terms,
			geoTerms: v.geoTerms ?? [],
			timespan: v.timespan,
			articles: v.displayGroups.slice(0, 12),
			total: v.total,
			stale: v.stale,
			newCount: pulse.perWatch[v.id]?.newCount ?? 0,
		})),
		pulse: {
			watchCount: views.length,
			totalArticles: views.reduce((n, v) => n + v.total, 0),
			changedCount: pulse.changedCount,
			firstVisit: pulse.firstVisit,
			ngramCount: ngramUrls.size,
		},
		ngramUrls: [...ngramUrls],
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
		await addWatch(db, formData.get("lensId")!.toString(), {
			label: formData.get("label")!.toString() || terms[0],
			terms,
			timespan: formData.get("timespan")?.toString() || undefined,
		});
	}

	return null;
}

function WatchCard({
	watch,
	ngramUrls,
	canEdit,
	onAskDelete,
}: {
	watch: {
		id: string;
		label: string;
		terms: string[];
		geoTerms: string[];
		timespan?: string;
		articles: { title: string; articles: Article[] }[];
		total: number;
		stale: boolean;
		newCount: number;
	};
	ngramUrls: string[];
	canEdit: boolean;
	onAskDelete: (w: { id: string; label: string }) => void;
}) {
	const ngramSet = new Set(ngramUrls);
	return (
		<div className="flex w-[360px] flex-shrink-0 flex-grow-0 flex-col rounded border border-gray-700 bg-gray-900">
			<div className="sticky top-0 border-b border-gray-700 bg-gray-900/95 p-4">
				<div className="mb-2 flex items-start justify-between gap-2">
					<h3 className="font-semibold text-blue-300">{watch.label}</h3>
					<div className="flex items-center gap-2 text-xs">
						{watch.newCount > 0 && (
							<span className="rounded-full bg-blue-600 px-2 py-0.5 font-semibold text-white">
								{watch.newCount} new
							</span>
						)}
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
				</div>
				<div className="text-xs text-gray-500">
					<span className="mr-2">{watch.total} articles</span>
					{watch.timespan && <span className="mr-2">· {watch.timespan}</span>}
					{watch.stale && <span className="text-yellow-600">· stale (GDELT throttling)</span>}
					{watch.geoTerms.length > 0 && (
						<span className="mr-2">· geo: {watch.geoTerms.join(", ")}</span>
					)}
					<span>· mentions-based</span>
				</div>
			</div>

			<div className="space-y-4 overflow-y-auto p-4">
				{watch.articles.length === 0 ? (
					<p className="text-sm text-gray-400">
						No coverage in this window — sparse results usually mean thin index coverage, not
						that nothing happened.
					</p>
				) : (
					watch.articles.map(({ title, articles }) => {
						const first = articles[0];
						const seenLabel = formatSeenLocal(first.seendate);
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
									{articles.length > 1 && <span>+{articles.length - 1} more</span>}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

export default function LensPage() {
	const { lens, watches, pulse, ngramUrls } = useLoaderData<typeof loader>();
	const navigation = useNavigation();
	const submit = useSubmit();
	const [showAdd, setShowAdd] = React.useState(false);
	const [pendingDelete, setPendingDelete] = React.useState<{ id: string; label: string } | null>(null);

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
				<Link to={`/lens/${lens.slug}/trends`} className="text-sm text-blue-400 hover:text-blue-300">
					Trends →
				</Link>
				<Link to="/feed" className="text-sm text-gray-400 hover:text-gray-300">
					Legacy columns →
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
						<WatchCard key={w.id} watch={w} ngramUrls={ngramUrls} canEdit onAskDelete={setPendingDelete} />
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
