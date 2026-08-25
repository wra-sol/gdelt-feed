import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/lib/cloudflare-context";

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

		// Keep DOC coverage warm on a schedule so visitors rarely trigger
		// upstream fetches themselves (throttle safety). Sequential loop =
		// paced automatically by gdeltApi's MIN_INTERVAL gate.
		try {
			const { getAllWatches } = await import("~/services/lensDb");
			const { watchRef } = await import("~/services/watchView");
			const { revalidateCoverage } = await import("~/services/coverage");
			for (const watch of await getAllWatches(db)) {
				const coverage = await revalidateCoverage(db, watchRef(watch));
				console.log("[coverage] warmed", watch.id, coverage.source);
			}
		} catch (error) {
			console.error("[coverage] warm failed:", error);
		}

		if ((env.NGRAMS_ENABLED ?? "").toLowerCase() !== "true") return;
		const { getAllWatches: allWatches } = await import("~/services/lensDb");
		const { ingestLatestMinute, pruneNgramHits } = await import("~/services/ngrams");
		const watches = await allWatches(db);

		try {
			const result = await ingestLatestMinute(db, watches);
			console.log("[ngrams] ingested", result);
			await pruneNgramHits(db);
		} catch (error) {
			console.error("[ngrams] ingestion failed:", error);
		}
	},
} satisfies ExportedHandler<Env>;
