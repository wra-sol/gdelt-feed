import { describe, expect, it } from "vitest";
import {
	loadFlagUrls,
	loadReadUrls,
	markReadUrls,
	toggleFlagUrl,
} from "~/lib/triage";

function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		},
	} as Storage;
}

describe("device-local triage sets", () => {
	it("flags toggle independently of reads and persist", () => {
		const storage = fakeStorage();
		markReadUrls(storage, ["https://a/1"]);
		expect(loadReadUrls(storage).has("https://a/1")).toBe(true);

		const afterOn = toggleFlagUrl(storage, "https://a/1");
		expect(afterOn.has("https://a/1")).toBe(true);
		expect(loadFlagUrls(storage)).toEqual(afterOn);

		const afterOff = toggleFlagUrl(storage, "https://a/1");
		expect(afterOff.has("https://a/1")).toBe(false);
		expect(loadFlagUrls(storage).size).toBe(0);
	});

	it("tolerates missing storage and corrupt payloads", () => {
		expect(loadFlagUrls(null).size).toBe(0);
		expect(toggleFlagUrl(undefined, "x").has("x")).toBe(true);
		const storage = fakeStorage();
		storage.setItem("m_flag_v1", "{not json");
		expect(loadFlagUrls(storage).size).toBe(0);
	});
});
