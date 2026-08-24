import { parseSort } from "~/services/gdeltApi";
import type { WatchDef } from "~/services/watchEngine";
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

export async function addWatch(db: D1Database, lensId: string, watch: NewWatch): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO watches (id, lens_id, label, terms, geo_terms, timespan, sort, maxrecords)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'DateDesc', ?7)`,
		)
		.bind(
			id,
			lensId,
			watch.label.slice(0, 80),
			JSON.stringify(watch.terms),
			watch.geoTerms?.length ? JSON.stringify(watch.geoTerms) : null,
			watch.timespan ?? null,
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
