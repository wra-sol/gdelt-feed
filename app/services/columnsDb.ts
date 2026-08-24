import {
	parseMode,
	parseSort,
	type GdeltFormat,
	type GdeltMode,
	type SortOrder,
} from "~/services/gdeltApi";
import { deleteCachedStmt } from "~/services/articleCache";

export interface ColumnDefinition {
	query: string;
	timespan?: string;
	mode?: GdeltMode;
	format?: GdeltFormat;
	sort?: SortOrder;
	maxrecords?: number;
}

type ColumnRow = {
	id: string;
	query: string;
	timespan: string | null;
	mode: string | null;
	format: string | null;
	sort: string | null;
	maxrecords: number | null;
};

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input.trim().toLowerCase()),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function rowToColumn(row: ColumnRow): ColumnDefinition & { id: string } {
	return {
		id: row.id,
		query: row.query,
		timespan: row.timespan ?? undefined,
		mode: parseMode(row.mode),
		format: row.format as GdeltFormat | undefined,
		sort: parseSort(row.sort),
		maxrecords: row.maxrecords ?? undefined,
	};
}

export async function getColumns(db: D1Database): Promise<(ColumnDefinition & { id: string })[]> {
	const { results } = await db.prepare("SELECT * FROM columns").all<ColumnRow>();
	return results.map(rowToColumn);
}

export async function addColumn(db: D1Database, columnDef: ColumnDefinition): Promise<string> {
	const id = await sha256Hex(columnDef.query);

	await db
		.prepare(
			`INSERT INTO columns (id, query, timespan, mode, format, sort, maxrecords)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT (id) DO UPDATE SET
			   timespan = ?3,
			   mode = ?4,
			   format = ?5,
			   sort = ?6,
			   maxrecords = ?7`,
		)
		.bind(
			id,
			columnDef.query,
			columnDef.timespan ?? null,
			columnDef.mode ?? null,
			columnDef.format ?? null,
			columnDef.sort ?? null,
			columnDef.maxrecords ?? null,
		)
		.run();

	return id;
}

export async function updateColumn(
	db: D1Database,
	id: string,
	columnDef: ColumnDefinition,
): Promise<void> {
	await db
		.prepare(
			`UPDATE columns
			 SET query = ?1, timespan = ?2, mode = ?3, format = ?4, sort = ?5, maxrecords = ?6
			 WHERE id = ?7`,
		)
		.bind(
			columnDef.query,
			columnDef.timespan ?? null,
			columnDef.mode ?? null,
			columnDef.format ?? null,
			columnDef.sort ?? null,
			columnDef.maxrecords ?? null,
			id,
		)
		.run();
}

export async function deleteColumn(db: D1Database, id: string): Promise<void> {
	await db.batch([
		db.prepare("DELETE FROM columns WHERE id = ?1").bind(id),
		deleteCachedStmt(db, id),
	]);
}
