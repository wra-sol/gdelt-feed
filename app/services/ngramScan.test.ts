import { describe, expect, it } from "vitest";
import { compileNeedles, paddedContains, scanQuadgrams, tokenizeQuadgram } from "~/services/ngramScan";

describe("compileNeedles", () => {
	it("lowercases and trims terms", () => {
		const compiled = compileNeedles([{ id: "w1", terms: ["  Carbon ", "CLIMATE"] }]);
		expect(compiled).toEqual([{ id: "w1", needles: ["carbon", "climate"] }]);
	});

	it("drops empty and whitespace-only terms at compile time", () => {
		const compiled = compileNeedles([{ id: "w1", terms: ["", "   ", "\t", "carbon"] }]);
		expect(compiled).toEqual([{ id: "w1", needles: ["carbon"] }]);
	});
});

describe("paddedContains (token-edge matching)", () => {
	const tokens = ["the", "housing", "market", "rose"];

	it("matches single-word needles by exact token equality", () => {
		expect(paddedContains(tokens, "housing")).toBe(true);
		expect(paddedContains(tokens, "housin")).toBe(false);
	});

	it("matches multi-word needles as a consecutive token sequence", () => {
		expect(paddedContains(tokens, "housing market")).toBe(true);
		expect(paddedContains(tokens, "the housing market")).toBe(true);
		expect(paddedContains(tokens, "housing rose")).toBe(false);
		expect(paddedContains(tokens, "market housing")).toBe(false);
	});

	it("strips punctuation glued to token edges before comparing", () => {
		const tokens = tokenizeQuadgram("carbon, \"climate\" (energy) prices rose");
		expect(tokens).toEqual(["carbon", "climate", "energy", "prices", "rose"]);
		expect(paddedContains(tokens, "carbon")).toBe(true);
		expect(paddedContains(tokens, "climate")).toBe(true);
		expect(paddedContains(tokens, "energy")).toBe(true);
	});

	it("scanner matches punctuation-adjacent tokens end to end", () => {
		const result = scanQuadgrams(["77\tbacking for carbon, pricing rises\t11"], [
			{ id: "w1", needles: ["carbon"] },
		]);
		expect(result.get("77")).toEqual(new Set(["carbon"]));
	});
});

describe("scanQuadgrams", () => {
	it("extracts the doc id from the DOCID\\tquadgram TSV format", () => {
		const result = scanQuadgrams(["100042\tthe carbon tax\t5"], [{ id: "w1", needles: ["carbon"] }]);
		expect([...result.keys()]).toEqual(["100042"]);
	});

	it("ignores malformed lines without a doc-id prefix", () => {
		const result = scanQuadgrams(["no tab here", "", "\tcarbon"], [
			{ id: "w1", needles: ["carbon"] },
		]);
		expect(result.size).toBe(0);
	});

	it("matches a single word needle inside a quadgram", () => {
		const result = scanQuadgrams(
			["42\tpushback against the carbon levy\t12"],
			[{ id: "w1", needles: ["carbon"] }],
		);
		expect(result.get("42")).toEqual(new Set(["carbon"]));
	});

	it("does not match substrings of longer tokens", () => {
		const result = scanQuadgrams(["7\tcarbonyl emissions spike\t3"], [
			{ id: "w1", needles: ["carbon"] },
		]);
		expect(result.size).toBe(0);
	});

	it("records ALL matching needles per doc, not just the first (provenance)", () => {
		const result = scanQuadgrams(["9\tglobal climate talks on carbon markets\t2"], [
			{ id: "w1", needles: ["carbon", "climate", "tariffs"] },
		]);
		expect(result.get("9")).toEqual(new Set(["carbon", "climate"]));
	});

	it("keeps matches separate per watch and per document", () => {
		const lines = ["1\tthe carbon tax\t4", "2\tclimate report released\t6"];
		const compiled = [
			{ id: "watch-a", needles: ["carbon"] },
			{ id: "watch-b", needles: ["climate", "report"] },
		];
		const result = scanQuadgrams(lines, compiled);
		expect(result.get("1")).toEqual(new Set(["carbon"]));
		expect(result.get("2")).toEqual(new Set(["climate", "report"]));
	});

	it("never produces matches for empty/whitespace-only needles", () => {
		const result = scanQuadgrams(["3\tjust some noise here\t1"], [
			{ id: "w1", needles: ["", "   "] },
		]);
		expect(result.size).toBe(0);
	});
});

describe("compile + scan integration", () => {
	it("end-to-end: compiled watches feed the scanner with clean provenance", () => {
		const compiled = compileNeedles([
			{ id: "housing", terms: ["Housing Market", "  "] },
			{ id: "climate", terms: ["carbon", ""] },
		]);
		const result = scanQuadgrams(
			[
				"500\tthe housing market cooled,\t8",
				"501\tcarbon, borders and leakage\t9",
			],
			compiled,
		);
		expect(result.get("500")).toEqual(new Set(["housing market"]));
		expect(result.get("501")).toEqual(new Set(["carbon"]));
	});
});
