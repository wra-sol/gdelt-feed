import React from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLensWithWatches } from "~/services/lensDb";
import { getCoverageCached } from "~/services/coverage";
import { watchRef } from "~/services/watchEngine";
import { getNgramDailySeries } from "~/services/ngrams";
import {
	averageTone,
	swrTimeline,
	type TimelinePoint,
} from "~/services/timeline";
import { withGrace } from "~/lib/freshGrace";
import { TrendChart } from "~/components/TrendChart";
import { getCloudflare } from "~/lib/cloudflare-context";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface WatchTrend {
	id: string;
	label: string;
	/** Instant: cached DOC timeline (may be empty on a cold watch). */
	points: TimelinePoint[];
	stale: boolean;
	/** Deferred: fresher timeline when one was due; null when cache is warm. */
	pointsPromise: Promise<{ points: TimelinePoint[]; stale: boolean }> | null;
	ngramSeries: { date: string; value: number }[];
	avgTone: number | null;
}

export async function loader({ params, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const found = await getLensWithWatches(db, params.slug!);
	if (!found) throw new Response("Lens not found", { status: 404 });
	const { lens, watches } = found;

	const ngramSeries = await getNgramDailySeries(
		db,
		watches.map((w) => w.id),
		30,
	);

	// INSTANT SHELL: swrTimeline reads D1 only. The slow DOC timeline call
	// runs as a deferred promise bounded by the same fresh-grace window as
	// the lens page — charts paint from cache immediately and silently swap
	// when fresher data lands (or degrade honestly when it doesn't).
	const FRESH_GRACE_MS = 15_000;
	const trends: WatchTrend[] = await Promise.all(
		watches.map(async (watch) => {
			const ref = watchRef(watch);
			const { immediate, fresh } = await swrTimeline(db, {
				id: ref.id,
				query: ref.query,
				timespan: watch.timespan,
			});
			const cached = await getCoverageCached(db, ref);

			let pointsPromise: Promise<{ points: TimelinePoint[]; stale: boolean }> | null = null;
			if (fresh) {
				pointsPromise = withGrace(
					fresh.then((t) => ({ points: t.points, stale: t.stale })),
					FRESH_GRACE_MS,
					() => ({ points: immediate.points, stale: true }),
				).catch((error: unknown) => {
					console.error(`[trends] fresh timeline failed for ${watch.label}:`, error);
					return { points: immediate.points, stale: true };
				});
			}

			return {
				id: watch.id,
				label: watch.label,
				points: immediate.points,
				stale: immediate.stale,
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

/** DOC timeline chart: instant cached points, optional deferred fresh swap. */
function DocTimeline({ trend }: { trend: WatchTrend }) {
	const fresh = trend.pointsPromise ? React.use(trend.pointsPromise) : null;
	const points = fresh?.points ?? trend.points;
	const stale = fresh?.stale ?? trend.stale;
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
								<DocTimeline trend={t} />
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
