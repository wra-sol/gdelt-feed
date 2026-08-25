import { parseSort, isValidTimespan } from "~/services/gdeltApi";
import { compileWatchQuery, type WatchDef } from "~/services/watchEngine";
import { deleteCachedStmt } from "~/services/articleCache";
import { deleteNgramHitsStmt } from "~/services/ngrams";

export interface Lens {
	id: string;
	slug: string;
	name: string;
	countryFips?: string;
	description?: string;
}

type LensRow = {
	id: string;
	slug: string;
	name: string;
	country_fips: string | null;
	description: string | null;
};

type WatchRow = {
	id: string;
	lens_id: string;
	label: string;
	terms: string;
	geo_terms: string | null;
	timespan: string | null;
	sort: string | null;
	maxrecords: number | null;
};

function rowToLens(row: LensRow): Lens {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		countryFips: row.country_fips ?? undefined,
		description: row.description ?? undefined,
	};
}

function rowToWatch(row: WatchRow): WatchDef {
	let terms: string[] = [];
	try {
		const parsed = JSON.parse(row.terms);
		if (Array.isArray(parsed)) terms = parsed.map(String);
	} catch {
		console.error(`Watch ${row.id}: unparsable terms`);
	}
	let geoTerms: string[] | undefined;
	if (row.geo_terms) {
		try {
			const parsed = JSON.parse(row.geo_terms);
			if (Array.isArray(parsed)) geoTerms = parsed.map(String);
		} catch {
			console.error(`Watch ${row.id}: unparsable geo_terms`);
		}
	}

	return {
		id: row.id,
		lensId: row.lens_id,
		label: row.label,
		terms,
		geoTerms,
		timespan: row.timespan ?? undefined,
		sort: parseSort(row.sort) ?? "DateDesc",
		maxrecords: row.maxrecords ?? undefined,
	};
}

export async function getLenses(db: D1Database): Promise<Lens[]> {
	const { results } = await db
		.prepare("SELECT id, slug, name, country_fips, description FROM lenses ORDER BY name")
		.all<LensRow>();
	return results.map(rowToLens);
}

export async function getLensBySlug(db: D1Database, slug: string): Promise<Lens | null> {
	const row = await db
		.prepare("SELECT id, slug, name, country_fips, description FROM lenses WHERE slug = ?1")
		.bind(slug)
		.first<LensRow>();
	return row ? rowToLens(row) : null;
}

export async function createLens(
	db: D1Database,
	lens: { slug: string; name: string; countryFips?: string; description?: string },
): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO lenses (id, slug, name, country_fips, description)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
		)
		.bind(id, lens.slug, lens.name, lens.countryFips ?? null, lens.description ?? null)
		.run();
	return id;
}

export async function getWatchesForLens(db: D1Database, lensId: string): Promise<WatchDef[]> {
	const { results } = await db
		.prepare(
			`SELECT id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords
			 FROM watches WHERE lens_id = ?1 ORDER BY created_at`,
		)
		.bind(lensId)
		.all<WatchRow>();
	return results.map(rowToWatch);
}

/** The Lens-with-Watches aggregate every consumer actually wants. */
export async function getLensWithWatches(
	db: D1Database,
	slug: string,
): Promise<{ lens: Lens; watches: WatchDef[] } | null> {
	const lens = await getLensBySlug(db, slug);
	if (!lens) return null;
	const watches = await getWatchesForLens(db, lens.id);
	return { lens, watches };
}

/** Every watch across all lenses (cron fan-out). */
export async function getAllWatches(db: D1Database): Promise<WatchDef[]> {
	const lenses = await getLenses(db);
	return (await Promise.all(lenses.map((l) => getWatchesForLens(db, l.id)))).flat();
}

export async function getWatch(db: D1Database, id: string): Promise<WatchDef | null> {
	const row = await db
		.prepare(
			`SELECT id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords
			 FROM watches WHERE id = ?1`,
		)
		.bind(id)
		.first<WatchRow>();
	return row ? rowToWatch(row) : null;
}

export interface NewWatch {
	label: string;
	terms: string[];
	geoTerms?: string[];
	timespan?: string;
	maxrecords?: number;
}

/**
 * The one write door for Watches. Validates what the read path cannot
 * survive — empty terms, bad timespans, queries over the 1000-char DOC
 * limit — by compiling before insert and throwing loudly (CONTEXT.md:
 * watch-query invariant). Every writer crosses this interface: form
 * actions, seed scripts, future tooling.
 */
export async function addWatch(db: D1Database, lensId: string, watch: NewWatch): Promise<string> {
	if (watch.terms.length === 0) throw new Error("Watch terms required");
	const timespan = watch.timespan;
	if (timespan && !isValidTimespan(timespan)) {
		throw new Error(`Invalid timespan: ${timespan}`);
	}
	compileWatchQuery({
		id: "pending",
		lensId,
		label: watch.label,
		terms: watch.terms,
		geoTerms: watch.geoTerms,
		timespan,
	});

	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'DateDesc', ?7)`,
		)
		.bind(
			id,
			lensId,
			(watch.label || watch.terms[0]).slice(0, 80),
			JSON.stringify(watch.terms),
			watch.geoTerms?.length ? JSON.stringify(watch.geoTerms) : null,
			timespan ?? null,
			watch.maxrecords ?? 50,
		)
		.run();
	return id;
}

export async function deleteWatch(db: D1Database, id: string): Promise<void> {
	await db.batch([
		db.prepare("DELETE FROM watches WHERE id = ?1").bind(id),
		deleteCachedStmt(db, id),
		deleteNgramHitsStmt(db, id),
	]);
}

export async function deleteLens(db: D1Database, id: string): Promise<void> {
	const { results } = await db
		.prepare("SELECT id FROM watches WHERE lens_id = ?1")
		.bind(id)
		.all<{ id: string }>();
	await db.batch([
		db.prepare("DELETE FROM lenses WHERE id = ?1").bind(id),
		...results.flatMap((w) => [deleteCachedStmt(db, w.id), deleteNgramHitsStmt(db, w.id)]),
	]);
}
