import { describe, expect, it } from "vitest";
import { computePulse } from "~/lib/pulse";
import type { Article } from "~/types/gdelt";

function art(seen: string): Article {
	return { url: `u-${seen}`, title: seen, seendate: seen };
}

describe("computePulse", () => {
	it("reports firstVisit when no lastSeen", () => {
		const p = computePulse([{ id: "w1", articles: [art("20260824T120000Z")] }], null);
		expect(p.firstVisit).toBe(true);
		expect(p.changedCount).toBe(0);
	});

	it("counts new articles per watch and in total", () => {
		const lastSeen = "2026-08-24T10:00:00.000Z";
		const p = computePulse(
			[
				{ id: "w1", articles: [art("20260824T090000Z"), art("20260824T110000Z")] },
				{ id: "w2", articles: [art("20260824T120000Z")] },
			],
			lastSeen,
		);
		expect(p.firstVisit).toBe(false);
		expect(p.perWatch["w1"].newCount).toBe(1);
		expect(p.perWatch["w2"].newCount).toBe(1);
		expect(p.changedCount).toBe(2);
	});
});
