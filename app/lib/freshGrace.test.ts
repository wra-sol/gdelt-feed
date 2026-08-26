import { describe, expect, it, vi } from "vitest";
import { withGrace } from "./freshGrace";

describe("withGrace()", () => {
	it("resolves the live value when it lands inside the window", async () => {
		const result = await withGrace(
			new Promise<string>((r) => setTimeout(() => r("live"), 5)),
			50,
			() => "fallback",
		);
		expect(result).toBe("live");
	});

	it("resolves the fallback when the window closes first", async () => {
		vi.useFakeTimers();
		const p = withGrace(
			new Promise<string>((r) => setTimeout(() => r("late"), 100)),
			10,
			() => "fallback",
		);
		await vi.advanceTimersByTimeAsync(11);
		await expect(p).resolves.toBe("fallback");
		vi.useRealTimers();
	});

	it("never rejects — a rejected source resolves to the fallback", async () => {
		const result = await withGrace(
			Promise.reject(new Error("boom")),
			50,
			() => "fallback",
		);
		expect(result).toBe("fallback");
	});
});
