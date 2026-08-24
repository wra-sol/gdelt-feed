import React from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLensBySlug, getWatchesForLens } from "~/services/lensDb";
import { compileWatchQuery } from "~/services/watchEngine";
import { fetchVolumeTimeline, averageTone, type TimelinePoint } from "~/services/timeline";
import { getCachedArticles } from "~/services/articleCache";
import { getNgramDailySeries } from "~/services/ngrams";
import { TrendChart } from "~/components/TrendChart";
import { getCloudflare } from "~/lib/cloudflare-context";

interface WatchTrend {
	id: string;
	label: string;
	/** Deferred: DOC volume timeline (slow upstream call). */
	pointsPromise: Promise<{ points: TimelinePoint[]; stale: boolean }>;
	ngramSeries: { date: string; value: number }[];
	avgTone: number | null;
}

export async function loader({ params, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const lens = await getLensBySlug(db, params.slug!);
	if (!lens) throw new Response("Lens not found", { status: 404 });

	const watches = await getWatchesForLens(db, lens.id);
	const ngramSeries = await getNgramDailySeries(
		db,
		watches.map((w) => w.id),
		30,
	);

	// Instant: ngram daily series + avg tone come from D1. The slow DOC
	// timeline call is deferred — the page streams its shell immediately.
	const trends: WatchTrend[] = await Promise.all(
		watches.map(async (watch) => {
			const query = compileWatchQuery(watch);
			const cached = await getCachedArticles(db, watch.id);

			const pointsPromise = fetchVolumeTimeline(query, watch.timespan ?? "3m")
				.then((points) => ({ points, stale: points.length === 0 }))
				.catch((error) => {
					console.error(`Timeline for ${watch.label} failed:`, error);
					return { points: [] as TimelinePoint[], stale: true };
				});

			return {
				id: watch.id,
				label: watch.label,
				pointsPromise,
				ngramSeries: ngramSeries.get(watch.id) ?? [],
				avgTone: averageTone(cached?.articles ?? []),
			};
		}),
	);

	return { lens: { slug: lens.slug, name: lens.name }, trends };
}

function ngramHistoryStart(series: { date: string }[]): string {
	return series[0]?.date ?? "—";
}

/** Deferred DOC timeline chart. */
function DocTimeline({ promise }: { promise: WatchTrend["pointsPromise"] }) {
	const { points, stale } = React.use(promise);
	return (
		<>
			<TrendChart points={points} stale={stale} width={880} height={80} />
			{stale && (
				<p className="mt-1 text-xs text-yellow-700">
					No timeline data (GDELT throttling or thin coverage).
				</p>
			)}
		</>
	);
}

function TimelineSkeleton() {
	return (
		<div className="animate-pulse" aria-hidden>
			<div className="h-20 w-full rounded bg-gray-800" />
		</div>
	);
}

export default function LensTrends() {
	const { lens, trends } = useLoaderData<typeof loader>();

	return (
		<div className="mx-auto max-w-5xl p-6">
			<div className="mb-6 flex items-baseline justify-between">
				<h1 className="text-2xl font-bold text-blue-300">
					Trends · {lens.name}
				</h1>
				<Link to={`/lens/${lens.slug}`} className="text-sm text-gray-400 hover:text-gray-300">
					← back to pulse
				</Link>
			</div>
			<p className="mb-6 text-sm text-gray-500">
				Top: GDELT's own volume timeline (rolling 3-month window), streaming in per watch. Bottom:
				Meridian's ingest history — matched articles per day from the ngram stream, accumulating
				since launch and owned by us. Comparisons are within-window only until history deepens.
			</p>

			{trends.length === 0 ? (
				<p className="text-gray-400">No watches to chart.</p>
			) : (
				<div className="space-y-4">
					{trends.map((t) => (
						<div key={t.id} className="rounded border border-gray-700 bg-gray-900 p-4">
							<div className="mb-2 flex items-center justify-between">
								<h2 className="font-medium text-gray-200">{t.label}</h2>
								{t.avgTone !== null && (
									<span
										className={`text-sm font-semibold ${
											t.avgTone >= 0 ? "text-green-500" : "text-red-400"
										}`}
									>
										avg tone {t.avgTone.toFixed(2)}
									</span>
								)}
							</div>

							<p className="mb-1 text-xs text-gray-500">
								GDELT volume · rolling 3-month window
							</p>
							<React.Suspense fallback={<TimelineSkeleton />}>
								<DocTimeline promise={t.pointsPromise} />
							</React.Suspense>

							<p className="mt-4 mb-1 text-xs text-gray-500">
								Meridian ingest history · matched articles/day ·{" "}
								<span className="text-blue-400">since {ngramHistoryStart(t.ngramSeries)}</span>
							</p>
							<TrendChart points={t.ngramSeries} width={880} height={64} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
