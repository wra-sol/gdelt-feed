import { describe, expect, it, vi } from "vitest";
import { createUpstreamGate } from "./upstreamGate";

/** Fake clock: sleep() advances time instantly; now() reads it. */
function fakeClock() {
	let t = 0;
	const sleeps: number[] = [];
	return {
		now: () => t,
		sleep: vi.fn(async (ms: number) => {
			t += ms;
			sleeps.push(ms);
		}),
		advance: (ms: number) => {
			t += ms;
		},
	};
}

describe("upstreamGate", () => {
	it("first acquire passes immediately without sleeping", async () => {
		const clock = fakeClock();
		const gate = createUpstreamGate(clock);
		await expect(gate.acquire()).resolves.toBeUndefined();
		expect(clock.sleep).not.toHaveBeenCalled();
	});

	it("queues a burst: the second caller sleeps out the spacing interval", async () => {
		const clock = fakeClock();
		const gate = createUpstreamGate({ ...clock });

		await gate.acquire();
		await gate.acquire();

		expect(clock.sleep).toHaveBeenCalledWith(5500);
		expect(clock.now()).toBe(5500);
	});

	it("markThrottled opens a cooldown: acquire rejects fast while it lasts", async () => {
		const clock = fakeClock();
		const gate = createUpstreamGate({ ...clock });

		gate.markThrottled();
		await expect(gate.acquire()).rejects.toMatchObject({ name: "UpstreamThrottledError" });
		expect(clock.sleep).not.toHaveBeenCalled();

		clock.advance(30_000);
		await expect(gate.acquire()).resolves.toBeUndefined();
	});

	it("cooldown wins over spacing — no sleep is attempted during cooldown", async () => {
		const clock = fakeClock();
		const gate = createUpstreamGate({ ...clock });

		await gate.acquire(); // nextAllowedAt = 5500
		gate.markThrottled(); // cooldown until 30000

		await expect(gate.acquire()).rejects.toThrow();
		clock.advance(29_000); // still inside cooldown
		await expect(gate.acquire()).rejects.toThrow();
	});
});
