import { createRequestHandler } from "react-router";
import { ingestLatestMinute } from "~/services/ngrams";
import { getWatchesForLens } from "~/services/lensDb";
import { getLenses } from "~/services/lensDb";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},

	async scheduled(_controller, env, _ctx) {
		if ((env.NGRAMS_ENABLED ?? "").toLowerCase() !== "true") return;
		const db = env.DB;
		const lenses = await getLenses(db);
		const watches = (
			await Promise.all(lenses.map((l) => getWatchesForLens(db, l.id)))
		).flat();

		try {
			const result = await ingestLatestMinute(db, watches, { enabled: true });
			console.log("[ngrams] ingested", result);
		} catch (error) {
			console.error("[ngrams] ingestion failed:", error);
		}
	},
} satisfies ExportedHandler<Env>;
