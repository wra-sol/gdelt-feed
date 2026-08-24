/**
 * Pure quadgram matching for NGRAMS ingestion (extracted from ngrams.ts).
 *
 * No I/O here — takes TSV lines (DOCID\tquadgram[\tcount]) plus compiled
 * watch needles and returns matched needles per document. Word-boundary
 * semantics live in this module: needles match whole TOKENS, so a token's
 * surrounding punctuation is stripped before comparison ("carbon," matches
 * "carbon") and multi-word needles must appear as a consecutive token run.
 */

export interface CompiledWatch {
	id: string;
	needles: string[];
}

/** Lowercase + trim terms; drop empty/whitespace-only terms at compile time. */
export function compileNeedles(
	watches: { id: string; terms: string[] }[],
): { id: string; needles: string[] }[] {
	return watches.map((w) => ({
		id: w.id,
		needles: w.terms
			.map((t) => t.toLowerCase().trim())
			.filter((t) => t.length > 0),
	}));
}

const LEADING_OR_TRAILING_NON_WORD = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Strip punctuation glued to a token's edges ("carbon," -> "carbon"). */
function normalizeToken(token: string): string {
	return token.replace(LEADING_OR_TRAILING_NON_WORD, "");
}

/**
 * Canonical quadgram tokenizer: lowercase, whitespace-split, edge-punctuation
 * stripped. Feed its output to paddedContains — that pairing IS the
 * word-boundary semantics of this module.
 */
export function tokenizeQuadgram(text: string): string[] {
	return text.toLowerCase().split(/\s+/).map(normalizeToken);
}

/**
 * Whole-token containment over a tokenized quadgram (`tokenizeQuadgram`).
 * Single-word needles require exact token equality; multi-word needles
 * require a consecutive-token sequence equality.
 */
export function paddedContains(haystackTokens: string[], needle: string): boolean {
	const needleTokens = needle.split(/\s+/);
	if (haystackTokens.length < needleTokens.length) {
		return false;
	}
	outer: for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
		for (let j = 0; j < needleTokens.length; j++) {
			if (haystackTokens[i + j] !== needleTokens[j]) continue outer;
		}
		return true;
	}
	return false;
}

export type ScanResult = Map<string, Set<string>>;

/**
 * Scan TSV lines for watch-term hits.
 *
 * Line format: DOCID\tquadgram[\tcount]. Lines without a doc-id prefix are
 * ignored. Every matching needle is recorded per (docId, watch) — provenance
 * is complete, not first-match-only.
 */
export function scanQuadgrams(lines: string[], compiled: CompiledWatch[]): ScanResult {
	const docTerms: ScanResult = new Map();

	for (const line of lines) {
		const tab = line.indexOf("\t");
		if (tab <= 0) continue;
		const docId = line.slice(0, tab);
		const tokens = tokenizeQuadgram(line.slice(tab + 1));
		if (tokens.length === 0) continue;

		for (const c of compiled) {
			for (const needle of c.needles) {
				if (!paddedContains(tokens, needle)) continue;
				let terms = docTerms.get(docId);
				if (!terms) {
					terms = new Set<string>();
					docTerms.set(docId, terms);
				}
				terms.add(needle);
			}
		}
	}

	return docTerms;
}
