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
		if ((env.NGRAMS_ENABLED ?? "").toLowerCase() !== "true") return;
		const db = env.DB;
		const { getLenses, getWatchesForLens } = await import("~/services/lensDb");
		const { ingestLatestMinute, pruneNgramHits } = await import("~/services/ngrams");
		const lenses = await getLenses(db);
		const watches = (
			await Promise.all(lenses.map((l) => getWatchesForLens(db, l.id)))
		).flat();

		try {
			const result = await ingestLatestMinute(db, watches);
			console.log("[ngrams] ingested", result);
			await pruneNgramHits(db);
		} catch (error) {
			console.error("[ngrams] ingestion failed:", error);
		}
	},
} satisfies ExportedHandler<Env>;
