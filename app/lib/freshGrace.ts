/**
 * Bounds a deferred freshness promise: resolve with the live value if it
 * lands in time, otherwise give up gracefully into a caller-supplied
 * fallback. Rejection counts as "not in time" — deferred streams must
 * never reject downstream (see CLIPBOARD: rr7-stream-timeout).
 *
 * Pure timing plumbing; no logging, no domain types.
 */
export function withGrace<T>(
	promise: Promise<T>,
	ms: number,
	fallback: () => T,
): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(fallback()), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(fallback());
			},
		);
	});
}
