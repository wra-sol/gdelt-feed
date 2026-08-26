/**
 * Client-side triage read-state — the queue model's memory of what a person
 * has already judged. Device-local by design (no accounts): lives in
 * localStorage and the UI says so. Pure functions take a Storage so tests can
 * inject a fake; callers pass browserReadStorage().
 */
export const READ_STORAGE_KEY = "m_read_v1";
export const FLAG_STORAGE_KEY = "m_flag_v1";

/** Browser storage accessor — null during SSR or when storage is unavailable. */
export function browserReadStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

function loadUrlSet(storage: Storage | null | undefined, key: string): Set<string> {
	if (!storage) return new Set();
	try {
		const raw = storage.getItem(key);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((u): u is string => typeof u === "string"));
	} catch {
		return new Set();
	}
}

function persistUrlSet(storage: Storage | null | undefined, key: string, urls: Iterable<string>): void {
	storage?.setItem(key, JSON.stringify([...urls]));
}

export function loadReadUrls(storage: Storage | null | undefined): Set<string> {
	return loadUrlSet(storage, READ_STORAGE_KEY);
}

/** Merge urls into the read set and persist. Returns the merged set. */
export function markReadUrls(
	storage: Storage | null | undefined,
	urls: readonly string[],
): Set<string> {
	const merged = new Set([...loadReadUrls(storage), ...urls]);
	persistUrlSet(storage, READ_STORAGE_KEY, merged);
	return merged;
}

export function loadFlagUrls(storage: Storage | null | undefined): Set<string> {
	return loadUrlSet(storage, FLAG_STORAGE_KEY);
}

/**
 * Toggle one url's flag and persist. Returns the next set. Flags are
 * device-local like read state — a personal watchlist inside the lens.
 */
export function toggleFlagUrl(storage: Storage | null | undefined, url: string): Set<string> {
	const next = loadFlagUrls(storage);
	if (next.has(url)) next.delete(url);
	else next.add(url);
	persistUrlSet(storage, FLAG_STORAGE_KEY, next);
	return next;
}
