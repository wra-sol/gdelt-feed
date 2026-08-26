import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/lib/cloudflare-context";
import { watchRef } from "~/services/watchEngine";

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env, ctx) {
		const provider = new RouterContextProvider();
		provider.set(cloudflareContext, { env, ctx });
		return requestHandler(request, provider);
	},

	async scheduled(_controller, env, _ctx) {
		const db = env.DB;

		// One aggregate read feeds both jobs (decision: Lens-with-Watches seam).
		const { getAllWatches } = await import("~/services/lensDb");
		const watches = await getAllWatches(db);

		// Keep DOC coverage warm so visitors rarely trigger upstream fetches
		// themselves. warmAllCoverage isolates poisoned rows per Watch and
		// the upstream gate paces the sequential loop.
		try {
			const { warmAllCoverage } = await import("~/services/coverage");
			const summary = await warmAllCoverage(db, watches);
			console.log("[coverage] warmed", summary);
		} catch (error) {
			console.error("[coverage] warm failed:", error);
		}

		// Timelines share the window policy; same sequential gate-paced loop.
		try {
			const { warmAllTimelines } = await import("~/services/timeline");
			const summary = await warmAllTimelines(
				db,
				watches.map((w) => {
					const ref = watchRef(w);
					return { id: ref.id, query: ref.query, timespan: w.timespan };
				}),
			);
			console.log("[timeline] warmed", summary);
		} catch (error) {
			console.error("[timeline] warm failed:", error);
		}

		if ((env.NGRAMS_ENABLED ?? "").toLowerCase() !== "true") return;
		const { ingestLatestMinute, pruneNgramHits } = await import("~/services/ngrams");

		try {
			const result = await ingestLatestMinute(db, watches);
			console.log("[ngrams] ingested", result);
			await pruneNgramHits(db);
		} catch (error) {
			console.error("[ngrams] ingestion failed:", error);
		}
	},
} satisfies ExportedHandler<Env>;
