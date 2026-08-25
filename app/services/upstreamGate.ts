/**
 * The upstream gate — Meridian's isolate-wide budget for the shared GDELT
 * upstream (HANDOFF: ≥5s spacing, bursts earn minutes-long cooldowns).
 *
 * Two policies, enforced before any network I/O:
 * - spacing: concurrent callers queue so a burst of visitors or parallel
 *   timelines cannot multiply requests. First caller passes immediately.
 * - cooldown: after markThrottled(), acquire() rejects fast for a window —
 *   callers degrade to cached state instead of stacking timeout+failover.
 *
 * Time is injected: production uses the real clock; tests use a fake one
 * and cross this interface directly.
 */

export class UpstreamThrottledError extends Error {
	constructor(message = 'upstream in throttle cooldown') {
		super(message);
		this.name = 'UpstreamThrottledError';
	}
}

export interface UpstreamGate {
	/** Resolves when a call may proceed; rejects with UpstreamThrottledError during cooldown. */
	acquire(): Promise<void>;
	/** Record a throttle signal — opens the cooldown window. */
	markThrottled(): void;
}

export interface UpstreamGateOptions {
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	minIntervalMs?: number;
	cooldownMs?: number;
}

export function createUpstreamGate(options: UpstreamGateOptions = {}): UpstreamGate {
	const now = options.now ?? (() => Date.now());
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const minIntervalMs = options.minIntervalMs ?? 5_500;
	const cooldownMs = options.cooldownMs ?? 30_000;

	let nextAllowedAt = 0;
	let cooldownUntil = 0;

	return {
		async acquire() {
			if (now() < cooldownUntil) {
				throw new UpstreamThrottledError();
			}
			const waitMs = nextAllowedAt - now();
			if (waitMs > 0) {
				await sleep(waitMs);
			}
			nextAllowedAt = now() + minIntervalMs;
		},
		markThrottled() {
			cooldownUntil = now() + cooldownMs;
		},
	};
}
