import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLensBySlug, getWatchesForLens } from "~/services/lensDb";
import { compileWatchQuery } from "~/services/watchEngine";
import { fetchVolumeTimeline, averageTone, type TimelinePoint } from "~/services/timeline";
import { getCachedArticles } from "~/services/articleCache";
import { getNgramDailySeries } from "~/services/ngrams";
import { TrendChart } from "~/components/TrendChart";

interface WatchTrend {
	id: string;
	label: string;
	points: TimelinePoint[];
	ngramSeries: { date: string; value: number }[];
	avgTone: number | null;
	stale: boolean;
}

export async function loader({ params, context }: LoaderFunctionArgs) {
	const db = context.cloudflare.env.DB;
	const lens = await getLensBySlug(db, params.slug!);
	if (!lens) throw new Response("Lens not found", { status: 404 });

	const watches = await getWatchesForLens(db, lens.id);
	const ngramSeries = await getNgramDailySeries(
		db,
		watches.map((w) => w.id),
		30,
	);

	const trends: WatchTrend[] = await Promise.all(
		watches.map(async (watch) => {
			const query = compileWatchQuery(watch);
			let points: TimelinePoint[] = [];
			let stale = false;
			try {
				points = await fetchVolumeTimeline(query, watch.timespan ?? "3m");
				if (points.length === 0) stale = true;
			} catch (error) {
				console.error(`Timeline for ${watch.label} failed:`, error);
				stale = true;
			}

			const cached = await getCachedArticles(db, watch.id);
			return {
				id: watch.id,
				label: watch.label,
				points,
				ngramSeries: ngramSeries.get(watch.id) ?? [],
				avgTone: averageTone(cached?.articles ?? []),
				stale,
			};
		}),
	);

	return { lens: { slug: lens.slug, name: lens.name }, trends };
}

function ngramHistoryStart(series: { date: string }[]): string {
	return series[0]?.date ?? "—";
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
				Top: GDELT's own volume timeline (rolling 3-month window). Bottom: Meridian's ingest
				history — matched articles per day from the ngram stream, accumulating since launch and
				owned by us. Comparisons are within-window only until history deepens.
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
						<TrendChart points={t.points} stale={t.stale} width={880} height={80} />
						{t.stale && (
							<p className="mt-1 text-xs text-yellow-700">
								No timeline data (GDELT throttling or thin coverage).
							</p>
						)}

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
