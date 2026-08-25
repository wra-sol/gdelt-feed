import React from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLensWithWatches } from "~/services/lensDb";
import { getCoverageCached } from "~/services/coverage";
import { compileWatchQuery } from "~/services/watchEngine";
import { watchRef } from "~/services/watchView";
import { getNgramDailySeries } from "~/services/ngrams";
import {
	fetchVolumeTimeline,
	averageTone,
	type TimelinePoint,
} from "~/services/timeline";
import { TrendChart } from "~/components/TrendChart";
import { getCloudflare } from "~/lib/cloudflare-context";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

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
	const found = await getLensWithWatches(db, params.slug!);
	if (!found) throw new Response("Lens not found", { status: 404 });
	const { lens, watches } = found;

	const ngramSeries = await getNgramDailySeries(		db,
		watches.map((w) => w.id),
		30,
	);

	// Instant: ngram daily series + avg tone come from D1. The slow DOC
	// timeline call is deferred — the page streams its shell immediately.
	const trends: WatchTrend[] = await Promise.all(
		watches.map(async (watch) => {
			const query = compileWatchQuery(watch);
			const cached = await getCoverageCached(db, watchRef(watch));

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
				<p className="mt-1 text-xs text-warning">
					No timeline data (GDELT throttling or thin coverage).
				</p>
			)}
		</>
	);
}

function TimelineSkeleton() {
	return (
		<div className="animate-pulse" aria-hidden>
			<Skeleton className="h-20 w-full rounded-lg" />
		</div>
	);
}

export default function LensTrends() {
	const { lens, trends } = useLoaderData<typeof loader>();

	return (
		<div className="mx-auto max-w-5xl p-6">
			<div className="mb-6 flex items-baseline justify-between">
				<h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
					Trends · {lens.name}
				</h1>
				<Link to={`/lens/${lens.slug}`} className={cn(buttonVariants({ variant: "ghost", size: "touch", className: "text-muted-foreground" }))}>
					← back to pulse
				</Link>
			</div>
			<p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
				Top: GDELT's own volume timeline (rolling 3-month window), streaming in per watch. Bottom:
				Meridian's ingest history — matched articles per day from the ngram stream, accumulating
				since launch and owned by us. Comparisons are within-window only until history deepens.
			</p>

			{trends.length === 0 ? (
				<p className="text-muted-foreground">No watches to chart — add one from the lens page.</p>
			) : (
				<div className="space-y-4">
					{trends.map((t) => (
						<Card key={t.id} className="p-4">
							<div className="mb-2 flex items-center justify-between">
								<h2 className="font-heading font-medium tracking-tight">{t.label}</h2>
								{t.avgTone !== null && (
									<span
										className={`font-mono text-sm font-semibold tabular-nums ${
											t.avgTone >= 0 ? "text-success" : "text-destructive"
										}`}
									>
										avg tone {t.avgTone.toFixed(2)}
									</span>
								)}
							</div>

							<p className="mb-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
								GDELT volume · rolling 3-month window
							</p>
							<React.Suspense fallback={<TimelineSkeleton />}>
								<DocTimeline promise={t.pointsPromise} />
							</React.Suspense>

							<p className="mt-4 mb-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
								Meridian ingest history · matched articles/day ·{" "}
								<span className="text-primary">since {ngramHistoryStart(t.ngramSeries)}</span>
							</p>
							<TrendChart points={t.ngramSeries} width={880} height={64} />
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
