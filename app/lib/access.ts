import type { RouterContextProvider } from "react-router";
import { getCloudflare } from "./cloudflare-context";

/**
 * Cloudflare Access gate.
 *
 * The edge-level Zero-Trust application (configured at deploy time) protects
 * mutation paths; this app-side middleware is belt-and-braces so writes fail
 * closed even if someone bypasses the edge policy. When the gate is enabled,
 * every write must carry a valid Cloudflare Access JWT — RS256 signature
 * checked against the team's published certs, not expired, audience matching
 * ACCESS_AUD. Missing ACCESS_TEAM_DOMAIN/ACCESS_AUD config fails closed.
 *
 * Reads and RSS stay public by design (decision #12). During seeding /
 * local dev, leave ACCESS_GATE_ENABLED unset or empty and everything passes.
 */

function gateEnabled(env: Env): boolean {
	return (env.ACCESS_GATE_ENABLED ?? "").toLowerCase() === "true";
}

interface AccessJwtHeader {
	alg: string;
	kid?: string;
}

interface AccessJwtClaims {
	exp?: number;
	aud?: string | string[];
}

function b64urlDecode(part: string): Uint8Array<ArrayBuffer> {
	const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

let jwksCache: { keys: AccessJwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

/** CF Access signing key — a JsonWebKey plus the key id used in JWT headers. */
type AccessJwk = JsonWebKey & { kid?: string };

async function accessJwks(teamDomain: string): Promise<AccessJwk[]> {
	if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
	const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
	const body = (await res.json()) as { keys?: AccessJwk[] };
	jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
	return jwksCache.keys;
}

/** Full verification: RS256 signature against the team JWKS + exp + aud. */
async function verifyAccessJwt(token: string, env: Env): Promise<boolean> {
	const teamDomain = env.ACCESS_TEAM_DOMAIN;
	const expectedAud = env.ACCESS_AUD;
	if (!teamDomain || !expectedAud) return false;

	const parts = token.split(".");
	if (parts.length !== 3) return false;

	let header: AccessJwtHeader;
	let claims: AccessJwtClaims;
	try {
		header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
		claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
	} catch {
		return false;
	}

	if (header.alg !== "RS256") return false;
	if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return false;
	const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!auds.includes(expectedAud)) return false;

	const jwks = await accessJwks(teamDomain);
	const jwk = jwks.find((k) => k.kid === header.kid);
	if (!jwk) return false;

	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		{ name: "RSASSA-PKCS1-v1_5" },
		key,
		b64urlDecode(parts[2]),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
}

export async function isWriteAllowed(request: Request, env: Env): Promise<boolean> {
	if (!gateEnabled(env)) return true;
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) return false;
	try {
		return await verifyAccessJwt(token, env);
	} catch (error) {
		console.error("[access] JWT verification failed:", error);
		return false;
	}
}

export function writeDenied(): Response {
	return new Response("Writes are gated during seeding", {
		status: 401,
		headers: { "Content-Type": "text/plain" },
	});
}

/** RRv8 route middleware: gates mutations (non-GET) behind the Access check. */
export async function writeGate({
	request,
	context,
}: {
	request: Request;
	context: RouterContextProvider;
}) {
	if (request.method === "GET") return;
	if (!(await isWriteAllowed(request, getCloudflare(context).env))) throw writeDenied();
}

/** Constant-time string comparison for bearer-style tokens. */
export function tokensMatch(a: string, b: string): boolean {
	const ab = new TextEncoder().encode(a);
	const bb = new TextEncoder().encode(b);
	if (ab.length !== bb.length) return false;
	let diff = 0;
	for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
	return diff === 0;
}

/**
 * Decision #12 in one place: RSS is public, but when the Access gate is on it
 * requires the unguessable per-deployment token so readers can poll
 * unauthenticated.
 */
export function rssTokenOk(env: Env, token: string | null): boolean {
	if (!gateEnabled(env)) return true;
	return Boolean(env.RSS_TOKEN && token && tokensMatch(token, env.RSS_TOKEN));
}
