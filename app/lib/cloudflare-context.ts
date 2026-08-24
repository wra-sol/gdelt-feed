import { createContext, type RouterContextProvider } from "react-router";

/**
 * RRv8 request context carrying Cloudflare bindings.
 * Set once in workers/app.ts via RouterContextProvider; read anywhere via getCloudflare().
 */
export const cloudflareContext = createContext<{
	env: Env;
	ctx: ExecutionContext;
} | null>(null);

export function getCloudflare(context: Readonly<RouterContextProvider>) {
	const cf = context.get(cloudflareContext);
	if (!cf) throw new Error("Cloudflare context missing — was the worker entry wired?");
	return cf;
}
