import { beforeAll, describe, expect, it, vi } from "vitest";
import { isWriteAllowed, rssTokenOk, tokensMatch } from "./access";

describe("tokensMatch", () => {
	it("matches equal strings and rejects differing ones", () => {
		expect(tokensMatch("secret-token", "secret-token")).toBe(true);
		expect(tokensMatch("secret-token", "secret-tokeN")).toBe(false);
		expect(tokensMatch("short", "shorter")).toBe(false);
		expect(tokensMatch("", "")).toBe(true);
	});
});

describe("rssTokenOk", () => {
	const env = (gate: string, rssToken?: string) =>
		({ ACCESS_GATE_ENABLED: gate, RSS_TOKEN: rssToken }) as never as Env;

	it("gate off: everything passes, even a missing token", () => {
		expect(rssTokenOk(env(""), null)).toBe(true);
		expect(rssTokenOk(env("", "tok"), null)).toBe(true);
	});

	it("gate on without a configured secret fails closed", () => {
		expect(rssTokenOk(env("true"), "anything")).toBe(false);
	});

	it("gate on: only the exact configured token passes", () => {
		const e = env("true", "rss-secret");
		expect(rssTokenOk(e, null)).toBe(false);
		expect(rssTokenOk(e, "wrong")).toBe(false);
		expect(rssTokenOk(e, "rss-secret")).toBe(true);
	});
});

/**
 * Full Access-JWT path through isWriteAllowed — real RS256 signatures via
 * WebCrypto, JWKS endpoint stubbed at the one boundary (fetch).
 */
describe("isWriteAllowed (Access JWT)", () => {
	const teamDomain = "team.example";
	const aud = "meridian-access-aud";

	let privateKey: CryptoKey;
	let publicJwk: JsonWebKey & { kid?: string };

	const gatedEnv = {
		ACCESS_GATE_ENABLED: "true",
		ACCESS_TEAM_DOMAIN: teamDomain,
		ACCESS_AUD: aud,
	} as never as Env;

	function b64url(input: string | Uint8Array): string {
		const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
		let bin = "";
		for (const b of bytes) bin += String.fromCharCode(b);
		return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	async function makeJwt(over: {
		expOffsetSec?: number;
		aud?: string;
		alg?: string;
		key?: CryptoKey;
	} = {}): Promise<string> {
		const header = { alg: over.alg ?? "RS256", typ: "JWT", kid: "test-key" };
		const claims = {
			exp: Math.floor(Date.now() / 1000) + (over.expOffsetSec ?? 300),
			aud: over.aud ?? aud,
			email: "pro@example.com",
		};
		const signingKey = over.key ?? privateKey;
		const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
		const sig = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			signingKey,
			new TextEncoder().encode(data),
		);
		return `${data}.${b64url(new Uint8Array(sig))}`;
	}

	const requestWith = (token?: string) =>
		new Request("https://meridian.example/lens/canada", {
			method: "POST",
			headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
		});

	beforeAll(async () => {
		const pair = (await crypto.subtle.generateKey(
			{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;
		privateKey = pair.privateKey;
		publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & {
			kid?: string;
		};
		publicJwk.kid = "test-key";

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })),
		);
	});

	it("gate off: writes pass without any token", async () => {
		const env = { ACCESS_GATE_ENABLED: "" } as never as Env;
		await expect(isWriteAllowed(requestWith(), env)).resolves.toBe(true);
	});

	it("gate on: missing header fails closed", async () => {
		await expect(isWriteAllowed(requestWith(), gatedEnv)).resolves.toBe(false);
	});

	it("accepts a valid, unexpired, correctly-audience JWT", async () => {
		await expect(isWriteAllowed(requestWith(await makeJwt()), gatedEnv)).resolves.toBe(true);
	});

	it("rejects an expired token", async () => {
		await expect(
			isWriteAllowed(requestWith(await makeJwt({ expOffsetSec: -10 })), gatedEnv),
		).resolves.toBe(false);
	});

	it("rejects a foreign audience", async () => {
		await expect(
			isWriteAllowed(requestWith(await makeJwt({ aud: "someone-elses-app" })), gatedEnv),
		).resolves.toBe(false);
	});

	it("rejects a non-RS256 algorithm claim", async () => {
		await expect(
			isWriteAllowed(requestWith(await makeJwt({ alg: "HS256" })), gatedEnv),
		).resolves.toBe(false);
	});

	it("rejects a token signed by an unknown key", async () => {
		const stranger = (await crypto.subtle.generateKey(
			{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;
		await expect(
			isWriteAllowed(requestWith(await makeJwt({ key: stranger.privateKey })), gatedEnv),
		).resolves.toBe(false);
	});

	it("rejects malformed tokens without throwing", async () => {
		await expect(isWriteAllowed(requestWith("not.a.jwt"), gatedEnv)).resolves.toBe(false);
		await expect(isWriteAllowed(requestWith("garbage"), gatedEnv)).resolves.toBe(false);
	});

	it("unconfigured team/aud fails closed even with a well-formed token", async () => {
		const env = { ACCESS_GATE_ENABLED: "true" } as never as Env;
		await expect(isWriteAllowed(requestWith(await makeJwt()), env)).resolves.toBe(false);
	});
});
