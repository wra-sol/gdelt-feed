import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	averageTone,
	parseVolumeTimeline,
	revalidateTimeline,
	swrTimeline,
	type TimelineKey,
	type TimelinePoint,
} from "./timeline";

const volumeTimeline = vi.fn();
vi.mock("~/services/gdeltApi", () => ({
	gdeltApi: { volumeTimeline: (...args: unknown[]) => volumeTimeline(...args) },
}));

/** In-memory timeline_cache standing in for D1 — enough surface for the annex. */
function fakeDb(
	table: Map<string, { points: string; last_fetched: string }> = new Map(),
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
							points: bound[1] as string,
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

const key: TimelineKey = { id: "w-test", query: "test query", timespan: "3m" };

const points = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, value: i }));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type CacheTable = Map<string, { points: string; last_fetched: string }>;

function seed(table: CacheTable, id: string, when: string, pts: TimelinePoint[]) {
	table.set(id, { points: JSON.stringify(pts), last_fetched: when });
}

beforeEach(() => {
	volumeTimeline.mockReset();
});

describe("parseVolumeTimeline", () => {
	it("leniently parses the timelinevol shape and drops non-finite values", () => {
		const raw = {
			timeline: [{ data: [{ series: "Volume Intensity", values: [["2026-08-01", "3"], ["2026-08-02", "x"]] }] }],
		};
		expect(parseVolumeTimeline(raw)).toEqual([{ date: "2026-08-01", value: 3 }]);
	});

	it("returns [] for any unexpected shape", () => {
		expect(parseVolumeTimeline({})).toEqual([]);
		expect(parseVolumeTimeline(null)).toEqual([]);
	});
});

describe("swrTimeline()", () => {
	it("fresh cache hit serves instantly without touching upstream", async () => {
		const table: CacheTable = new Map();
		seed(table, key.id, minutesAgo(2), points(3));
		const { immediate, fresh } = await swrTimeline(fakeDb(table), key);
		expect(immediate.points).toHaveLength(3);
		expect(immediate.stale).toBe(false);
		expect(fresh).toBeNull();
		expect(volumeTimeline).not.toHaveBeenCalled();
	});

	it("cold watch paints empty and streams a live revalidation that lands in cache", async () => {
		const table: CacheTable = new Map();
		volumeTimeline.mockResolvedValue({
			timeline: [{ data: [{ series: "Volume Intensity", values: [["2026-08-01", "7"]] }] }],
		});
		const db = fakeDb(table);
		const { immediate, fresh } = await swrTimeline(db, key);

		expect(immediate.stale).toBe(true);
		expect(immediate.points).toHaveLength(0);
		expect(fresh).not.toBeNull();

		const landed = await fresh!;
		expect(landed.points).toEqual([{ date: "2026-08-01", value: 7 }]);
		expect(landed.stale).toBe(false);
		expect(table.has(key.id)).toBe(true);
	});

	it("window semantics: one missed cycle stays nominal, two degrade — revalidation due at one", async () => {
		const agingTable: CacheTable = new Map();
		seed(agingTable, "w-aging", minutesAgo(16), points(2));
		const agingResult = await swrTimeline(fakeDb(agingTable), { ...key, id: "w-aging" });
		expect(agingResult.immediate.stale).toBe(false);
		expect(agingResult.fresh).not.toBeNull();

		const oldTable: CacheTable = new Map();
		seed(oldTable, "w-old", minutesAgo(31), points(2));
		const oldResult = await swrTimeline(fakeDb(oldTable), { ...key, id: "w-old" });
		expect(oldResult.immediate.stale).toBe(true);
		expect(oldResult.fresh).not.toBeNull();
	});
});

describe("revalidateTimeline()", () => {
	it("degrades to stale cache on upstream failure — never throws", async () => {
		const table: CacheTable = new Map();
		seed(table, key.id, minutesAgo(31), points(4));
		volumeTimeline.mockRejectedValue(new Error("GDELT down"));

		const result = await revalidateTimeline(fakeDb(table), key);
		expect(result.stale).toBe(true);
		expect(result.points).toHaveLength(4);
		expect(result.fetchedAt).toBe((table.get(key.id) as { last_fetched: string }).last_fetched);
	});

	it("survives a failing recovery read after upstream failure — resolves degraded", async () => {
		const table: CacheTable = new Map();
		seed(table, key.id, minutesAgo(31), points(4));
		volumeTimeline.mockRejectedValue(new Error("GDELT down"));

		// swrTimeline performs two SELECTs: #1 the instant cache read,
		// #2 the degrade-path recovery read after upstream fails.
		let reads = 0;
		const inner = fakeDb(table);
		const db = {
			prepare(sql: string) {
				const stmt = inner.prepare(sql);
				if (!sql.includes("SELECT")) return stmt;
				const wrapper = {
					bind(...args: unknown[]) {
						(stmt.bind as (...a: unknown[]) => unknown)(...args);
						return wrapper;
					},
					async first<T>() {
						reads++;
						if (reads === 2) throw new Error("D1 transient error");
						return stmt.first<T>();
					},
					run() {
						return stmt.run();
					},
				};
				return wrapper as unknown as D1PreparedStatement;
			},
		} as unknown as D1Database;

		const { immediate, fresh } = await swrTimeline(db, key);
		expect(immediate.stale).toBe(true);
		await expect(fresh).resolves.toMatchObject({
			stale: true,
			points: [],
			fetchedAt: null,
		});
	});
});

describe("averageTone", () => {
	it("returns null for no articles or no numeric tones", () => {
		expect(averageTone([])).toBeNull();
		expect(averageTone([{}, { tone: undefined }])).toBeNull();
	});

	it("ignores non-numeric tones and averages the rest", () => {
		const result = averageTone([{ tone: 2 }, {}, { tone: 4 }, { tone: -1.5 }]);
		expect(result).toBeCloseTo(1.5);
	});

	it("handles all-negative sets", () => {
		expect(averageTone([{ tone: -4 }, { tone: -2 }])).toBe(-3);
	});
});
