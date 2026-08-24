/**
 * Cloudflare Access gate.
 *
 * The edge-level Zero-Trust application (configured at deploy time) protects
 * mutation paths; this app-side check is belt-and-braces so writes fail closed
 * even if someone bypasses the edge policy.
 *
 * Reads and RSS stay public by design (decision #12). During seeding /
 * local dev, leave ACCESS_GATE_ENABLED unset or empty and everything passes.
 */
export function isWriteAllowed(request: Request, env: Env): boolean {
	if ((env.ACCESS_GATE_ENABLED ?? "").toLowerCase() !== "true") return true;
	return request.headers.has("Cf-Access-Jwt-Assertion");
}

export function writeDenied(): Response {
	return new Response("Writes are gated during seeding", {
		status: 401,
		headers: { "Content-Type": "text/plain" },
	});
}
