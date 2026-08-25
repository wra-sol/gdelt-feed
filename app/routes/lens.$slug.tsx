import React from "react";
import {
	Form,
	Link,
	useLoaderData,
	useNavigation,
	useSubmit,
	type LoaderFunctionArgs,
} from "react-router";
import type { Article } from "~/types/gdelt";
import { swr } from "~/services/coverage";
import {
	getLensWithWatches,
	addWatch,
	deleteWatch,
} from "~/services/lensDb";
import { getRecentNgramHits } from "~/services/ngrams";
import {
	buildWatchView,
	watchRef,
	type FreshView,
} from "~/services/watchView";
import { groupArticlesByTitle, type ArticleGroup } from "~/lib/grouping";
import { formatSeenUtc } from "~/lib/date";
	import { computePulse } from "~/lib/pulse";
	import { seenCookieValue, seenCookieWrite } from "~/lib/lastSeen";
	import { lensFlag } from "~/data/countries";
import { writeGate } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input, inputVariants } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { RadarIcon, RssIcon } from "lucide-react";

/**
 * The count-honest per-watch view and its blending rules live in
 * services/watchView.ts — this route renders them.
 */

type NgramHit = Awaited<ReturnType<typeof getRecentNgramHits>>[number];

export const middleware = [writeGate];

export async function loader({ params, request, context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const found = await getLensWithWatches(db, params.slug!);
	if (!found) throw new Response("Lens not found", { status: 404 });
	const { lens, watches } = found;

	const lastSeenIso = seenCookieValue(request, lens.slug);

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
						displayGroups: fv.displayGroups,
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
			flag: lensFlag(lens.countryFips),
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
		// addWatch owns validation — it refuses what reads cannot survive.
		// This action only translates refusals into HTTP.
		try {
			await addWatch(db, formData.get("lensId")!.toString(), {
				label: formData.get("label")!.toString(),
				terms: formData
					.get("terms")!
					.toString()
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
				timespan: formData.get("timespan")?.toString() || undefined,
			});
		} catch (error) {
			return new Response(error instanceof Error ? error.message : "invalid watch", {
				status: 400,
			});
		}
	}

	return null;
}

type WatchData = Awaited<ReturnType<typeof loader>>["watches"][number];

function WatchList({ articles, ngramUrls }: { articles: ArticleGroup[]; ngramUrls: string[] }) {
	const ngramSet = new Set(ngramUrls);
	if (articles.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
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
					<div key={title} className="border-t border-border pt-3 first:border-0 first:pt-0">
						<a
							href={first.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
						>
							{title}
						</a>
						<div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
							{ngramSet.has(first.url) && (
								<Badge variant="secondary" className="uppercase tracking-wide">
									ngram
								</Badge>
							)}
							<span>{first.domain ?? "N/A"}</span>
							{seenLabel && <span>{seenLabel}</span>}
							{typeof first.tone === "number" && (
								<span
									className={
										first.tone >= 0
											? "text-success"
											: "text-destructive"
									}
								>
									{first.tone > 0 ? "+" : ""}
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
		<div className="relative flex max-h-[80vh] w-[360px] flex-shrink-0 flex-grow-0 flex-col rounded-xl border border-border bg-card">
			<div className="sticky top-0 z-10 rounded-t-xl border-b border-border bg-card/95 p-4 backdrop-blur">
				<div className="mb-1 flex items-start justify-between gap-2">
					<h3 className="font-heading font-semibold text-foreground">{watch.label}</h3>
					{canEdit && (
						<Button
							variant="ghost"
							size="touch"
							className="-mr-2 -mt-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
							onPress={() => onAskDelete({ id: watch.id, label: watch.label })}
						>
							Delete
						</Button>
					)}
				</div>
				<div className="font-mono text-xs text-muted-foreground">
					{watch.timespan && <span className="mr-2">· {watch.timespan}</span>}
					{watch.geoTerms.length > 0 && (
						<span className="mr-2">· geo: {watch.geoTerms.join(", ")}</span>
					)}
					<span>· mentions-based</span>
				</div>
			</div>

			<React.Suspense
				fallback={
					<div className="space-y-3 p-4" role="status" aria-label="Fetching latest coverage">
						<p className="flex items-center gap-2 text-xs text-primary">
							<Spinner className="size-3" />
							Fetching latest coverage…
						</p>
						{[0, 1, 2].map((i) => (
							<div key={i} className="space-y-1.5 border-t border-border pt-3 first:border-0 first:pt-0">
								<Skeleton className="h-3 w-full" />
								<Skeleton className="h-2.5 w-2/3" />
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
			<div className="flex items-center gap-2 border-b border-border px-4 pb-2 pt-3 text-xs text-muted-foreground">
				{newCount > 0 && <Badge>{newCount} new</Badge>}
				<span className="font-mono">{total} articles</span>
				{stale && (
					<span className="text-warning">· stale (GDELT throttling)</span>
				)}
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
		document.cookie = seenCookieWrite(lens.slug);
	}, [lens.slug]);

	return (
		<div className="mx-auto p-4">
			{/* React 19 hoists head links rendered anywhere. Plain URL: when the
			    Access gate is on, feeds are shared as tokened URLs instead —
			    never embed RSS_TOKEN in page HTML. */}
			<link
				rel="alternate"
				type="application/rss+xml"
				title={`${lens.name} — Meridian`}
				href={`/rss/lens/${lens.slug}`}
			/>
			<div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="flex items-center gap-2 font-heading text-xl font-bold tracking-tight text-foreground">
						{lens.flag && <span className="text-2xl">{lens.flag}</span>}
						{lens.name}
					</h1>
					{lens.description && <p className="mt-1 text-sm text-muted-foreground">{lens.description}</p>}
				</div>
				<div className="text-right font-mono text-sm text-muted-foreground">
					<p>
						<span className="text-lg font-semibold tabular-nums text-foreground">{pulse.watchCount}</span>{" "}
						watches ·{" "}
						<span className="text-lg font-semibold tabular-nums text-foreground">{pulse.totalArticles}</span>{" "}
						articles
					</p>
					<p className="mt-1">
						{pulse.firstVisit ? (
							<span>First visit — baseline recorded</span>
						) : pulse.changedCount > 0 ? (
							<span className="font-semibold text-primary">
								{pulse.changedCount} new since your last visit
							</span>
						) : (
							<span>No changes since your last visit</span>
						)}
						{pulse.ngramCount > 0 && (
							<span className="ml-2 opacity-70">incl. {pulse.ngramCount} via ngram stream</span>
						)}
					</p>
				</div>
			</div>

			{navigation.state !== "idle" && (
				<p role="status" className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
					<Spinner className="size-3" />
					Working…
				</p>
			)}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Button
					onPress={() => setShowAdd((s) => !s)}
					isDisabled={navigation.state !== "idle"}
					size="touch"
				>
					+ Add watch
				</Button>
				<a
					href={`/rss/lens/${lens.slug}`}
					title={`${lens.name} RSS feed`}
					className={cn(buttonVariants({ variant: "outline", size: "touch", className: "px-3" }))}
				>
					<RssIcon className="size-4" aria-hidden />
					<span className="sr-only">RSS feed</span>
				</a>
				<Link prefetch="intent" viewTransition to={`/lens/${lens.slug}/trends`} className={cn(buttonVariants({ variant: "outline", size: "touch" }))}>
					Trends →
				</Link>
				<Link prefetch="intent" viewTransition to="/lenses" className={cn(buttonVariants({ variant: "ghost", size: "touch", className: "text-muted-foreground" }))}>
					All lenses →
				</Link>
			</div>

			{showAdd && (
				<Form method="post" className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
					<input type="hidden" name="intent" value="add-watch" />
					<input type="hidden" name="lensId" value={lens.id} />
					<label className="flex flex-col gap-1 text-sm font-medium text-foreground md:col-span-2">
						Label
						<Input name="label" placeholder="e.g., Carbon policy" />
					</label>
					<label className="flex flex-col gap-1 text-sm font-medium text-foreground md:col-span-2">
						Terms (comma-separated)
						<Input name="terms" required placeholder='"carbon tax", emissions, Ottawa' inputMode="text" />
					</label>
					<label className="flex flex-col gap-1 text-sm font-medium text-foreground">
						Timespan
						<select
							name="timespan"
							className={cn(inputVariants(), "appearance-none bg-card")}
							defaultValue="7d"
						>
							<option value="7d">7 days</option>
							<option value="14d">14 days</option>
							<option value="1m">1 month</option>
							<option value="3m">3 months</option>
						</select>
					</label>
					<div className="flex items-end">
						<Button type="submit" pending={navigation.state === "submitting"} pendingLabel="Creating…">
							Create watch
						</Button>
					</div>
				</Form>
			)}

			{watches.length === 0 ? (
				<Empty className="mt-6 border border-dashed">
					<EmptyHeader>
						<EmptyMedia>
							<RadarIcon aria-hidden />
						</EmptyMedia>
						<EmptyTitle>No watches in this lens yet</EmptyTitle>
						<EmptyDescription>
							A watch follows a topic in this place — terms are matched across 65+ languages.
						</EmptyDescription>
					</EmptyHeader>
					<Button onPress={() => setShowAdd(true)} variant="outline" size="touch">
						Add the first watch
					</Button>
				</Empty>
			) : (
				<div className="flex space-x-4 overflow-x-auto pb-4">
					{watches.map((w) => (
						<WatchCard key={w.id} watch={w} canEdit onAskDelete={setPendingDelete} />
					))}
				</div>
			)}

			<AlertDialog
				isOpen={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete “{pendingDelete?.label}”?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the watch and its saved coverage from this lens. This can't be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onPress={() => {
								if (!pendingDelete) return;
								const formData = new FormData();
								formData.append("intent", "delete-watch");
								formData.append("watchId", pendingDelete.id);
								submit(formData, { method: "post" });
								setPendingDelete(null);
							}}
						>
							Delete watch
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
