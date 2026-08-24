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
 * Compile a structured Watch into a DOC 2.0 query string.
 * v1 arbiter: mentions-based (see docs/adr-001-lens-model.md).
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

	return `${termBlock}${geoBlock}`.slice(0, 1000);
}
