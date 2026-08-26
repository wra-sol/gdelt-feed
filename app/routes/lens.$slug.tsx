import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	Link,
	isRouteErrorResponse,
	useLoaderData,
	useNavigation,
	useRouteError,
	useSearchParams,
	useSubmit,
	type LoaderFunctionArgs,
} from "react-router";
import { swr } from "~/services/coverage";
import {
	getLensWithWatches,
	addWatch,
	deleteWatch,
} from "~/services/lensDb";
import { getRecentNgramHits } from "~/services/ngrams";
import {
	buildWatchView,
	buildFreshView,
	type FreshView,
} from "~/services/watchView";
import { watchRef } from "~/services/watchEngine";
import { computePulse } from "~/lib/pulse";
import { withGrace } from "~/lib/freshGrace";
	import { seenCookieValue, seenCookieWrite } from "~/lib/lastSeen";
	import { lensFlag } from "~/data/countries";
import { writeGate } from "~/lib/access";
import { getCloudflare } from "~/lib/cloudflare-context";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	CoverageConsole,
	CoverageConsoleFallback,
	SensorStrip,
} from "~/components/coverageConsole";
import { CHANNEL_HUES } from "~/lib/consoleModel";
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
import { RadarIcon, RssIcon, TrashIcon } from "lucide-react";
import { WatchEditor } from "~/components/watchEditor";

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
	const FRESH_GRACE_MS = 15_000;
	const built = await Promise.all(
		watches.map(async (watch) => {
			const hits = hitsByWatch.get(watch.id) ?? [];
			const { immediate, fresh } = await swr(db, watchRef(watch));
			const view = buildWatchView(watch, immediate.articles, hits, immediate.stale);
			let freshPromise: Promise<FreshView> | null = null;
			if (fresh) {
				freshPromise = withGrace(
					fresh
						.then((coverage) =>
							buildFreshView(
								watch,
								coverage.articles,
								hitsByWatch.get(watch.id) ?? [],
								coverage.stale,
								lastSeenIso,
							),
						)
						.catch((error: unknown) => {
							console.error(`[lens] fresh stream failed for ${watch.id}:`, error);
							throw error;
						}),
					FRESH_GRACE_MS,
					// Degrade to the immediate inputs, honestly marked stale.
					() => buildFreshView(watch, immediate.articles, hits, true, lastSeenIso),
				);
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
				geoTerms: formData
					.get("geoTerms")
					?.toString()
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

/**
 * The lens page: masthead, watch management, and the coverage console.
 * Count-honest per-watch blending lives in services/watchView.ts; the
 * console's pure state rules live in lib/consoleModel.ts — this route
 * orchestrates and renders.
 */

export default function LensPage() {
	const data = useLoaderData<typeof loader>();
	const { lens, watches, pulse } = data;
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

	// Goal-gradient payoff: a created watch closes its editor immediately.
	const wasSubmitting = React.useRef(false);
	React.useEffect(() => {
		if (navigation.state === "submitting") wasSubmitting.current = true;
		else if (wasSubmitting.current && navigation.state === "idle") {
			wasSubmitting.current = false;
			setShowAdd(false);
		}
	}, [navigation.state]);

	return (
		<div className="mx-auto max-w-7xl p-4">
			{/* React 19 hoists head links rendered anywhere. Plain URL: when the
			    Access gate is on, feeds are shared as tokened URLs instead —
			    never embed RSS_TOKEN in page HTML. */}
			<link
				rel="alternate"
				type="application/rss+xml"
				title={`${lens.name} — Meridian`}
				href={`/rss/lens/${lens.slug}`}
			/>
			{watches.map((w) => (
				<link
					key={w.id}
					rel="alternate"
					type="application/rss+xml"
					title={`${lens.name} · ${w.label} — Meridian`}
					href={`/rss/lens/${lens.slug}/${w.id}`}
				/>
			))}
			<div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="flex items-center gap-2 font-heading text-xl font-bold tracking-tight text-foreground">
						{lens.flag && <span className="text-2xl">{lens.flag}</span>}
						{lens.name}
					</h1>
					{lens.description && <p className="mt-1 text-sm text-muted-foreground">{lens.description}</p>}
				</div>
				<div className="flex items-center gap-3">
					<SensorStrip stale={watches.some((w) => w.stale)} />
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

			{showAdd && <WatchEditor lensId={lens.id} onDone={() => setShowAdd(false)} />}

			{watches.length > 0 && (
				<div className="mb-4 flex flex-wrap gap-2" aria-label="Watches">
					{watches.map((w, wi) => (
						<span
							key={w.id}
							className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
						>
							<span className="inline-block size-1.5 rounded-full" style={{ background: CHANNEL_HUES[wi % CHANNEL_HUES.length] }} aria-hidden />
							<span className="max-w-40 truncate font-medium text-foreground">{w.label}</span>
							<span className="tabular-nums">{w.total}</span>
							{w.newCount > 0 && <span className="font-semibold tabular-nums text-primary">+{w.newCount}</span>}
							{w.stale && <span className="text-warning">cached</span>}
							<a
								href={`/rss/lens/${lens.slug}/${w.id}`}
								title={`${w.label} RSS feed`}
								className="rounded p-0.5 hover:text-primary"
							>
								<RssIcon className="size-3.5" aria-hidden />
								<span className="sr-only">{w.label} RSS feed</span>
							</a>
							<button
								type="button"
								title={`Delete ${w.label}`}
								onClick={() => setPendingDelete({ id: w.id, label: w.label })}
								className="rounded p-0.5 hover:text-destructive"
							>
								<TrashIcon className="size-3.5" aria-hidden />
								<span className="sr-only">Delete {w.label}</span>
							</button>
						</span>
					))}
				</div>
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
				<React.Suspense fallback={<CoverageConsoleFallback />}>
					<CoverageConsole watches={watches} sinceLastVisit={pulse.changedCount} />
				</React.Suspense>
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

/**
 * Branded failure surface — the instrument panel never shows a raw
 * "Something went wrong". 404s (unknown lens) get their own message;
 * anything else reads as a sensor outage, which is what it is.
 */
export function ErrorBoundary() {
	const error = useRouteError();
	const notFound = isRouteErrorResponse(error) && error.status === 404;

	return (
		<div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
			<RadarIcon className="size-10 text-muted-foreground" aria-hidden />
			<div>
				<h1 className="font-heading text-xl font-semibold">
					{notFound ? "No such lens" : "Signal lost"}
				</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					{notFound
						? "There's no lens at this address. It may have been removed, or the link is wrong."
						: "The coverage feed for this lens hit an outage. The rest of Meridian is still listening."}
				</p>
			</div>
			<div className="flex items-center gap-3">
				<Link to="." className={buttonVariants({ variant: "outline", size: "touch" })}>
					Retry
				</Link>
				<Link to="/" className={buttonVariants({ size: "touch" })}>
					Back to home
				</Link>
			</div>
		</div>
	);
}
