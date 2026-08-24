import type { SortOrder } from "~/services/gdeltApi";

export interface WatchDef {
	id: string;
	lensId: string;
	label: string;
	/** Search terms — OR'd together as the topic block. */
	terms: string[];
	/** Required toponyms appended to approximate subject geography on DOC. */
	geoTerms?: string[];
	timespan?: string;
	sort?: SortOrder;
	maxrecords?: number;
}

function quoteTerm(term: string): string {
	const t = term.trim();
	return /\s/.test(t) ? `"${t}"` : t;
}

/**
 * GDELT DOC rejects queries outside 3–1000 chars. Clipping would silently
 * amputate terms and return plausible-but-wrong coverage forever, so the
 * invariant fails loudly instead.
 */
export const MAX_QUERY_LENGTH = 1000;

/**
 * Compile a structured Watch into a DOC 2.0 query string.
 * v1 arbiter: mentions-based (see docs/adr-001-lens-model.md).
 * Throws when no terms or the compiled query exceeds MAX_QUERY_LENGTH —
 * validate at write time (add-watch) so this never fires on healthy rows.
 */
export function compileWatchQuery(watch: WatchDef): string {
	if (watch.terms.length === 0) throw new Error(`Watch ${watch.id} has no terms`);

	const termBlock =
		watch.terms.length === 1
			? quoteTerm(watch.terms[0])
			: `(${watch.terms.map(quoteTerm).join(" OR ")})`;

	const geoBlock = watch.geoTerms?.length
		? " " + watch.geoTerms.map(quoteTerm).join(" ")
		: "";

	const query = `${termBlock}${geoBlock}`;
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error(
			`Watch ${watch.id}: compiled query is ${query.length} chars (max ${MAX_QUERY_LENGTH}) — trim terms or geo`,
		);
	}
	return query;
}
