import { describe, expect, it } from "vitest";
import { buildWatchView, type NgramHit } from "./watchView";
import { watchRef } from "./watchEngine";
import type { WatchDef } from "./watchEngine";
import type { Article } from "~/types/gdelt";
import { parseSeenDate } from "~/lib/date";

const watch: WatchDef = {
	id: "w1",
	lensId: "l1",
	label: "Carbon policy",
	terms: ["carbon tax", "emissions"],
};

const doc: Article = {
	url: "https://example.com/a",
	title: "Canada carbon policy",
	seendate: "20260824T120000Z",
};

const hit = (over: Partial<NgramHit> = {}): NgramHit => ({
	watchId: "w1",
	url: "https://ngram.example/b",
	publishedAt: "2026-08-24T13:00:00.000Z",
	...over,
});

describe("watchRef", () => {
	it("compiles the query and passes policy fields through", () => {
		const ref = watchRef({ ...watch, timespan: "7d", maxrecords: 30 });
		expect(ref.id).toBe("w1");
		expect(ref.query).toBe('("carbon tax" OR emissions)');
		expect(ref.timespan).toBe("7d");
		expect(ref.maxrecords).toBe(30);
	});
});

describe("buildWatchView — count honesty", () => {
	it("an ngram hit merging into an existing title group does not inflate total", () => {
		const view = buildWatchView(watch, [doc], [hit({ title: doc.title })], false);
		expect(view.total).toBe(1);
		expect(view.displayGroups).toHaveLength(1);
		expect(view.displayGroups[0].articles).toHaveLength(2);
	});

	it("an ngram-only story forms its own group without touching total", () => {
		const view = buildWatchView(watch, [doc], [hit()], false);
		expect(view.total).toBe(1);
		expect(view.displayGroups.map((g) => g.title)).toContain("https://ngram.example/b");
	});

	it("doc URLs never appear in ngramUrls", () => {
		const view = buildWatchView(watch, [doc], [hit({ url: doc.url })], false);
		expect(view.ngramUrls).toHaveLength(0);
		expect(view.displayGroups[0].articles).toHaveLength(1);
	});

	it("ngram pseudo-articles carry seendate parsed from publishedAt", () => {
		const view = buildWatchView(watch, [], [hit({ title: "Solo" })], false);
		const pseudo = view.displayGroups[0].articles[0];
		expect(pseudo.seendate).toBeDefined();
		expect(parseSeenDate(pseudo.seendate)?.toISOString()).toContain("2026-08-24T13:00:00");
	});
});

describe("buildWatchView — structure", () => {
	it("propagates staleness from Coverage", () => {
		expect(buildWatchView(watch, [doc], [], true).stale).toBe(true);
		expect(buildWatchView(watch, [doc], [], false).stale).toBe(false);
	});

	it("applies the display-group cap exactly once", () => {
		const docs: Article[] = Array.from({ length: 15 }, (_, i) => ({
			url: `https://example.com/${i}`,
			title: `Story ${i}`,
		}));
		const view = buildWatchView(watch, docs, [], false);
		expect(view.displayGroups).toHaveLength(12);
		expect(view.total).toBe(15);
	});
});
