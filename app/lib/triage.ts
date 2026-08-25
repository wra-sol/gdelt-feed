/**
 * Client-side triage read-state — the queue model's memory of what a person
 * has already judged. Device-local by design (no accounts): lives in
 * localStorage and the UI says so. Pure functions take a Storage so tests can
 * inject a fake; callers pass browserReadStorage().
 */
export const READ_STORAGE_KEY = "m_read_v1";

/** Browser storage accessor — null during SSR or when storage is unavailable. */
export function browserReadStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadReadUrls(storage: Storage | null | undefined): Set<string> {
	if (!storage) return new Set();
	try {
		const raw = storage.getItem(READ_STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((u): u is string => typeof u === "string"));
	} catch {
		return new Set();
	}
}

/** Merge urls into the read set and persist. Returns the merged set. */
export function markReadUrls(
	storage: Storage | null | undefined,
	urls: readonly string[],
): Set<string> {
	const merged = new Set([...loadReadUrls(storage), ...urls]);
	storage?.setItem(READ_STORAGE_KEY, JSON.stringify([...merged]));
	return merged;
}
