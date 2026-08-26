import { beforeEach, describe, expect, it, vi } from "vitest";
import { swr, revalidateCoverage, warmAllCoverage, type Coverage } from "./coverage";
import type { WatchDef, WatchRef } from "./watchEngine";

const searchArticles = vi.fn();
vi.mock("~/services/gdeltApi", () => ({
	gdeltApi: { searchArticles: (...args: unknown[]) => searchArticles(...args) },
}));

/** In-memory article_cache standing in for D1 — enough surface for the annex. */
function fakeDb(
	table: Map<string, { articles: string; last_fetched: string }> = new Map(),
): D1Database {
	return {
		prepare(sql: string) {
			const isSelect = sql.includes("SELECT");
			const isInsert = sql.includes("INSERT");
			let bound: unknown[] = [];
			const stmt = {
				bind(...args: unknown[]) {
					bound = args;
					return stmt;
				},
				async first<T>() {
					if (!isSelect) return null;
					return table.get(bound[0] as string) ?? null;
				},
				async run() {
					if (isInsert) {
						table.set(bound[0] as string, {
							articles: bound[1] as string,
							last_fetched: bound[2] as string,
						});
					}
					return { success: true };
				},
			};
			return stmt;
		},
	} as unknown as D1Database;
}

const ref: WatchRef = { id: "w-test", query: "test query", timespan: "7d" };

const article = (url: string) => ({ url, title: `Story ${url}`, domain: "example.com" });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Wraps fakeDb so the Nth SELECT rejects — simulates a transient D1 error. */
function readFailsOn(db: D1Database, nth: number): D1Database {
	let reads = 0;
	return {
		prepare(sql: string) {
			const inner = (db as unknown as { prepare: (s: string) => D1PreparedStatement }).prepare(
				sql,
			);
			if (!sql.includes("SELECT")) return inner;
			const wrapper = {
				bind(...args: unknown[]) {
					(inner.bind as (...a: unknown[]) => unknown)(...args);
					return wrapper;
				},
				async first<T>() {
					reads++;
					if (reads === nth) throw new Error("D1 transient error");
					return inner.first<T>();
				},
				run() {
					return inner.run();
				},
			};
			return wrapper as unknown as D1PreparedStatement;
		},
	} as unknown as D1Database;
}

type CacheTable = Map<string, { articles: string; last_fetched: string }>;

function seed(table: CacheTable, id: string, when: string, urls: string[]) {
	table.set(id, { articles: JSON.stringify(urls.map(article)), last_fetched: when });
}

beforeEach(() => {
	searchArticles.mockReset();
});

describe("swr()", () => {
	it("fresh cache hit serves instantly without touching upstream", async () => {
		const table: CacheTable = new Map();
		seed(table, ref.id, minutesAgo(2), ["https://a.example/1"]);
		const { immediate, fresh } = await swr(fakeDb(table), ref);

		expect(immediate.stale).toBe(false);
		expect(immediate.source).toBe("cache");
		expect(immediate.fetchedAt).toBe((table.get(ref.id) as any).last_fetched);
		expect(immediate.articles).toHaveLength(1);
		expect(fresh).toBeNull();
		expect(searchArticles).not.toHaveBeenCalled();
	});

	it("stale cache paints instantly and streams a live revalidation that lands in cache", async () => {
		const table: CacheTable = new Map();
		searchArticles.mockResolvedValue({ articles: [article("https://b.example/2")] });
		const db = fakeDb(table);
		const { immediate, fresh } = await swr(db, ref);

		expect(immediate.stale).toBe(true);
		expect(immediate.articles).toHaveLength(0);
		expect(fresh).not.toBeNull();

		const landed: Coverage = await fresh!;
		expect(landed.source).toBe("gdelt");
		expect(landed.stale).toBe(false);
		expect(landed.articles.map((a) => a.url)).toEqual(["https://b.example/2"]);
		expect(table.has(ref.id)).toBe(true);
	});

	it("window semantics: one missed cycle stays nominal, two degrade — revalidation due at one", async () => {
		const freshTable: CacheTable = new Map();
		seed(freshTable, "w-fresh", minutesAgo(14), ["https://a.example/1"]);
		const freshResult = await swr(fakeDb(freshTable), { ...ref, id: "w-fresh" });
		expect(freshResult.immediate.stale).toBe(false);
		expect(freshResult.fresh).toBeNull();

		// 16 min old = one window missed: still within GDELT's own index
		// granularity → NO degradation banner, but a background refresh runs.
		const agingTable: CacheTable = new Map();
		seed(agingTable, "w-aging", minutesAgo(16), ["https://a.example/1"]);
		searchArticles.mockResolvedValue({ articles: [] });
		const agingResult = await swr(fakeDb(agingTable), { ...ref, id: "w-aging" });
		expect(agingResult.immediate.stale).toBe(false);
		expect(agingResult.fresh).not.toBeNull();

		// 31 min old = two consecutive windows missed → honestly degraded.
		const oldTable: CacheTable = new Map();
		seed(oldTable, "w-old", minutesAgo(31), ["https://a.example/1"]);
		const oldResult = await swr(fakeDb(oldTable), { ...ref, id: "w-old" });
		expect(oldResult.immediate.stale).toBe(true);
		expect(oldResult.fresh).not.toBeNull();
	});
});

describe("revalidateCoverage()", () => {
	it("degrades to stale-cache on upstream failure — never throws", async () => {
		const table: CacheTable = new Map();
		seed(table, ref.id, minutesAgo(30), ["https://cached.example/old"]);
		searchArticles.mockRejectedValue(new Error("GDELT down"));

		const result = await revalidateCoverage(fakeDb(table), ref);
		expect(result.source).toBe("stale-cache");
		expect(result.stale).toBe(true);
		expect(result.articles.map((a) => a.url)).toEqual(["https://cached.example/old"]);
		expect(result.fetchedAt).toBe(minutesFrom(table));
	});

	function minutesFrom(table: CacheTable): string {
		return (table.get(ref.id) as { last_fetched: string }).last_fetched;
	}

	/** Regression: the degrade-path recovery read must never reject the fresh
	 * promise — a transient D1 error there used to escape silently and blow up
	 * the client via React.use(). */
	it("survives a failing recovery read after upstream failure — resolves degraded", async () => {
		const table: CacheTable = new Map();
		seed(table, ref.id, minutesAgo(30), ["https://cached.example/old"]);
		searchArticles.mockRejectedValue(new Error("GDELT down"));

		const db = readFailsOn(fakeDb(table), 2); // 1st read = immediate, 2nd = recovery
		const { immediate, fresh } = await swr(db, ref);
		expect(immediate.stale).toBe(true);

		await expect(fresh).resolves.toMatchObject({
			source: "stale-cache",
			stale: true,
			articles: [],
			fetchedAt: null,
		});
	});

	it("clamps maxrecords into [1, 250]", async () => {
		searchArticles.mockResolvedValue({ articles: [] });
		await revalidateCoverage(fakeDb(new Map()), { ...ref, id: "w-hi", maxrecords: 999 });
		expect(searchArticles.mock.calls[0][0].maxrecords).toBe(250);

		await revalidateCoverage(fakeDb(new Map()), { ...ref, id: "w-lo", maxrecords: 0 });
		expect(searchArticles.mock.calls[1][0].maxrecords).toBe(1);
	});

	it("single-flights concurrent revalidations of the same watch", async () => {
		let resolveFlight!: (v: { articles: unknown[] }) => void;
		searchArticles.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFlight = resolve;
			}),
		);

		const p1 = revalidateCoverage(fakeDb(new Map()), { ...ref, id: "w-flight" });
		const p2 = revalidateCoverage(fakeDb(new Map()), { ...ref, id: "w-flight" });

		resolveFlight({ articles: [article("https://once.example/1")] });
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(searchArticles).toHaveBeenCalledTimes(1);
		expect(r1.articles).toEqual(r2.articles);
	});
});

describe("warmAllCoverage()", () => {
	const def = (id: string, terms: string[] = ["topic"]): WatchDef => ({
		id,
		lensId: "l1",
		label: id,
		terms,
	});

	beforeEach(() => {
		searchArticles.mockResolvedValue({ articles: [article("https://warm.example/1")] });
	});

	it("warms every healthy watch and reports the summary", async () => {
		const table: CacheTable = new Map();
		const summary = await warmAllCoverage(fakeDb(table), [
			def("w-a"),
			def("w-b"),
			def("w-c"),
		]);

		expect(summary).toEqual({ warmed: 3, degraded: 0, failed: 0 });
		expect(table.size).toBe(3);
	});

	it("one poisoned watch fails alone — the rest still warm", async () => {
		const table: CacheTable = new Map();
		const summary = await warmAllCoverage(fakeDb(table), [
			def("w-good-1"),
			def("w-poisoned", []), // empty terms → compileWatchQuery throws
			def("w-good-2"),
		]);

		expect(summary.failed).toBe(1);
		expect(summary.warmed).toBe(2);
		expect(table.has("w-good-1")).toBe(true);
		expect(table.has("w-good-2")).toBe(true);
		expect(table.has("w-poisoned")).toBe(false);
	});

	it("counts throttle-degraded revalidations as degraded, not warmed", async () => {
		searchArticles.mockRejectedValue(new Error("GDELT down"));
		const summary = await warmAllCoverage(fakeDb(new Map()), [def("w-x"), def("w-y")]);
		expect(summary).toEqual({ warmed: 0, degraded: 2, failed: 0 });
	});
});
