import { describe, expect, it } from "vitest";
import { buildParams } from "./gdeltApi";

describe("buildParams", () => {
	it("applies artlist/json defaults and DateDesc sort", () => {
		const p = buildParams({ query: "climate change" });
		expect(p.get("query")).toBe("climate change");
		expect(p.get("mode")).toBe("artlist");
		expect(p.get("format")).toBe("json");
		expect(p.get("sort")).toBe("DateDesc");
		expect(p.get("maxrecords")).toBe("75");
		expect(p.has("timespan")).toBe(false);
	});

	it("appends timespan only when set", () => {
		const p = buildParams({ query: "inflation", timespan: "7d" });
		expect(p.get("timespan")).toBe("7d");
	});

	it.each([
		["ab", undefined], // too short
		["x".repeat(1001), undefined], // too long
		["valid query", "4h!"], // invalid timespan grammar
		["valid query", "forever"], // invalid timespan word
	])("rejects invalid input %j / %j", (query, timespan) => {
		expect(() =>
			buildParams({ query: query as string, timespan: timespan as string }),
		).toThrow();
	});

	it("enforces maxrecords bounds", () => {
		expect(() => buildParams({ query: "ok query", maxrecords: 0 })).toThrow();
		expect(() => buildParams({ query: "ok query", maxrecords: 251 })).toThrow();
		expect(buildParams({ query: "ok query", maxrecords: 250 }).get("maxrecords")).toBe("250");
	});

	it("accepts timelinevol mode", () => {
		const p = buildParams({ query: "ok query", mode: "timelinevol" });
		expect(p.get("mode")).toBe("timelinevol");
	});
});
