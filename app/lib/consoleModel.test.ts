import { describe, expect, it } from "vitest";
import {
	applyView,
	buildContacts,
	clampSelection,
	matchesView,
} from "~/lib/consoleModel";

function source(label: string, groups: { title: string; url: string; seendate?: string; tone?: number }[], ngramUrls: string[] = []) {
	return {
		label,
		displayGroups: groups.map((g) => ({ title: g.title, articles: [g] })),
		ngramUrls,
	};
}

describe("buildContacts", () => {
	it("flattens watches to a recency-sorted list with channel metadata", () => {
		const contacts = buildContacts(
			[
				source("Politics", [
					{ title: "Older", url: "u1", seendate: "2026-08-24T10:00:00Z" },
					{ title: "Newer", url: "u2", seendate: "2026-08-24T12:00:00Z" },
				]),
				source("Economy", [{ title: "Mid", url: "u3", seendate: "2026-08-24T11:00:00Z", tone: -7 }], ["u3"]),
			],
			new Set(),
		);
		expect(contacts.map((c) => c.title)).toEqual(["Newer", "Mid", "Older"]);
		expect(contacts[0].channelLabel).toBe("Politics");
		expect(contacts[1].channel).toBe(1);
		expect(contacts[1].ngram).toBe(true);
		expect(contacts[1].tone).toBe(-7);
	});

	it("counts extra group members and honours the read set", () => {
		const contacts = buildContacts(
			[
				{
					label: "W",
					displayGroups: [
						{ title: "T", articles: [{ url: "u1", title: "T", seendate: "2026-08-24T10:00:00Z" }, { url: "dup", title: "T" }] },
					],
					ngramUrls: [],
				},
			],
			new Set(["u1"]),
		);
		expect(contacts[0].moreInGroup).toBe(1);
		expect(contacts[0].read).toBe(true);
	});

	it("skips empty groups and tolerates missing timestamps", () => {
		const contacts = buildContacts(
			[{ label: "W", displayGroups: [{ title: "T", articles: [] }, { title: "U", articles: [{ url: "u9", title: "U" }] }], ngramUrls: [] }],
			new Set(),
		);
		expect(contacts.length).toBe(1);
		expect(contacts[0].seenTs).toBeNull();
	});
});

describe("applyView / matchesView", () => {
	const contacts = buildContacts(
		[
			source("W", [
				{ title: "fresh unread", url: "a", seendate: "2026-08-24T12:00:00Z" },
				{ title: "ngram only", url: "b", tone: 1 },
			], ["b"]),
			source("V", [{ title: "negative tone", url: "c", tone: -7 }]),
			source("U", [{ title: "pinned", url: "d" }]),
		],
		new Set(["a"]),
		new Set(["d"]),
	);

	it("NEW is exactly the unread set", () => {
		expect(applyView(contacts, "NEW").map((c) => c.url)).toEqual(["b", "c", "d"]);
	});

	it("NGRAM flags provenance without implying unread", () => {
		expect(matchesView(contacts[1], "NGRAM")).toBe(true);
		expect(matchesView(contacts[1], "NEW")).toBe(true); // b unread
		expect(matchesView(contacts[0], "NGRAM")).toBe(false);
	});

	it("FLAGGED is the device-local flag set, not a tone policy", () => {
		expect(matchesView(contacts[3], "FLAGGED")).toBe(true); // d flagged
		expect(matchesView(contacts[2], "FLAGGED")).toBe(false); // c unflagged despite tone -7
		expect(applyView(contacts, "FLAGGED").map((c) => c.url)).toEqual(["d"]);
	});
});

describe("clampSelection", () => {
	it("always names a row of the shown slice", () => {
		expect(clampSelection(3, 5)).toBe(3);
		expect(clampSelection(9, 5)).toBe(4);
		expect(clampSelection(-2, 5)).toBe(0);
		expect(clampSelection(0, 0)).toBe(0);
	});
});
