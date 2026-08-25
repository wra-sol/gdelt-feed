import { describe, expect, it } from "vitest";
import {
	loadReadUrls,
	markReadUrls,
	READ_STORAGE_KEY,
} from "~/lib/triage";

function fakeStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear: () => map.clear(),
		key: (i) => [...map.keys()][i] ?? null,
		get length() {
			return map.size;
		},
	} as Storage;
}

describe("loadReadUrls", () => {
	it("returns empty set without storage", () => {
		expect(loadReadUrls(null).size).toBe(0);
	});

	it("returns empty set on missing or corrupt payload", () => {
		expect(loadReadUrls(fakeStorage()).size).toBe(0);
		expect(loadReadUrls(fakeStorage({ [READ_STORAGE_KEY]: "{oops" })).size).toBe(0);
		expect(loadReadUrls(fakeStorage({ [READ_STORAGE_KEY]: '"just a string"' })).size).toBe(0);
	});

	it("ignores non-string entries", () => {
		const store = fakeStorage({ [READ_STORAGE_KEY]: '["a", 3, null, "b"]' });
		expect([...loadReadUrls(store)]).toEqual(["a", "b"]);
	});
});

describe("markReadUrls", () => {
	it("merges with existing urls and persists them", () => {
		const store = fakeStorage({ [READ_STORAGE_KEY]: '["old"]' });
		const merged = markReadUrls(store, ["new1", "new2"]);
		expect(merged.has("old")).toBe(true);
		expect(merged.has("new1")).toBe(true);
		expect(loadReadUrls(store)).toEqual(merged);
	});

	it("is a no-op persist without storage but still reports the merge", () => {
		const merged = markReadUrls(null, ["x"]);
		expect(merged.has("x")).toBe(true);
	});
});
