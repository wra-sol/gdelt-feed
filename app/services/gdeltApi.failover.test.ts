import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createGdeltApi,
	GdeltRateLimitError,
	type GdeltApiClient,
} from "./gdeltApi";
import type { UpstreamGate } from "./upstreamGate";

const JSON_HEADERS = { headers: new Headers({ "content-type": "application/json" }) };

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), JSON_HEADERS);
}

function textResponse(text: string, status = 200): Response {
	return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

/** Scripted fetch: one queued response per call; records each request. */
function scriptedFetch(responses: (Response | Error)[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const impl = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const next = responses[calls.length - 1];
		if (!next) throw new Error("scriptedFetch exhausted");
		if (next instanceof Error) throw next;
		return next;
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

function fakeGate(overrides: Partial<UpstreamGate> = {}): UpstreamGate & { marked: number } {
	return {
		acquire: vi.fn(async () => {}),
		markThrottled: vi.fn(() => {
			overrides.markThrottled?.();
		}),
		...overrides,
		marked: 0,
	} as UpstreamGate & { marked: number };
}

function apiWith(
	fetchResponses: (Response | Error)[],
	gateOverrides: Partial<UpstreamGate> = {},
): { api: GdeltApiClient; calls: { url: string; init?: RequestInit }[]; gate: ReturnType<typeof fakeGate> } {
	const gate = fakeGate(gateOverrides);
	const { impl, calls } = scriptedFetch(fetchResponses);
	return { api: createGdeltApi({ gate, fetchImpl: impl }), calls, gate };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createGdeltApi — failure modes through the caller interface", () => {
	it("throws the last error when the only host fails — no decoy failover", async () => {
		const { api, calls } = apiWith([
			new Error("primary unreachable"),
			jsonResponse({ status: "OK", articles: [{ url: "u1", title: "T" }] }),
		]);
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toThrow(
			"primary unreachable",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain("api.gdeltproject.org");
	});

	it("recognises HTTP-200 plain-text throttle as a rate limit and marks the gate", async () => {
		const markThrottled = vi.fn();
		const { api } = apiWith(
			[
				textResponse("Please limit requests to one every 5 seconds"),
			],
			{ markThrottled },
		);
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toBeInstanceOf(
			GdeltRateLimitError,
		);
		expect(markThrottled).toHaveBeenCalledOnce();
	});

	it("treats HTTP 429 as final — no retry, no second host", async () => {
		const { api, calls } = apiWith([textResponse("too many", 429)]);
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toBeInstanceOf(
			GdeltRateLimitError,
		);
		expect(calls).toHaveLength(1);
	});

	it("surfaces non-JSON garbage as a thrown error", async () => {
		const { api, calls } = apiWith([
			textResponse("<html>not json at all</html>"),
			jsonResponse({ status: "OK", articles: [] }),
		]);
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toThrow(
			"Non-JSON response",
		);
		expect(calls).toHaveLength(1);
	});

	it("fast-fails with a rate-limit error when the gate is in cooldown", async () => {
		const { api, calls } = apiWith([], {
			acquire: vi.fn(async () => {
				throw new Error("cooldown");
			}),
		});
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toBeInstanceOf(
			GdeltRateLimitError,
		);
		expect(calls).toHaveLength(0);
	});

	it("surfaces API-level ERROR payloads as thrown errors", async () => {
		const { api } = apiWith([jsonResponse({ status: "ERROR", error: "bad query" })]);
		await expect(api.searchArticles({ query: "climate policy" })).rejects.toThrow("bad query");
	});

	it("sends a browser user agent", async () => {
		const { api, calls } = apiWith([jsonResponse({ status: "OK", articles: [] })]);
		await api.searchArticles({ query: "climate policy" });
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get("user-agent")).toMatch(/^Mozilla\/5\.0/);
	});
});
