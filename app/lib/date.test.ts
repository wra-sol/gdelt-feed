import { describe, expect, it } from "vitest";
import { parseSeenDate, seenToRfc822, isoToSeenDate } from "~/lib/date";

describe("parseSeenDate", () => {
	it("parses GDELT seendate format", () => {
		const d = parseSeenDate("20260824T120000Z");
		expect(d?.toISOString()).toBe("2026-08-24T12:00:00.000Z");
	});

	it("falls back to Date parsing for ISO strings", () => {
		expect(parseSeenDate("2026-08-24T12:00:00.000Z")?.toISOString()).toBe(
			"2026-08-24T12:00:00.000Z",
		);
	});

	it("returns null for garbage and undefined", () => {
		expect(parseSeenDate(undefined)).toBeNull();
		expect(parseSeenDate("nope")).toBeNull();
	});
});

describe("seenToRfc822", () => {
	it("produces RFC-822", () => {
		expect(seenToRfc822("20260824T120000Z")).toBe("Mon, 24 Aug 2026 12:00:00 GMT");
	});
});

describe("isoToSeenDate round-trip", () => {
	it("round-trips through parseSeenDate", () => {
		const seen = isoToSeenDate("2026-08-24T15:31:00.000Z")!;
		expect(parseSeenDate(seen)?.toISOString()).toBe("2026-08-24T15:31:00.000Z");
	});
});
