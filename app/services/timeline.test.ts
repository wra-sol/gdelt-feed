import { describe, expect, it } from "vitest";
import { averageTone } from "./timeline";

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
