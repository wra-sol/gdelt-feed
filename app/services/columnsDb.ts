import { PGlite } from "@electric-sql/pglite";
import type { GdeltMode, GdeltFormat, SortOrder } from "~/services/gdeltApi";
import crypto from 'crypto';

// We match the shape of feed.tsx's ColumnDefinition
export interface ColumnDefinition {
  query: string;
  timespan?: string;
  mode?: GdeltMode;
  format?: GdeltFormat;
  sort?: SortOrder;
  maxrecords?: number;
}

let db: PGlite | null = null;

// Add hash function
function hashQuery(query: string): string {
  return crypto.createHash('md5').update(query.trim().toLowerCase()).digest('hex');
}

// Update table schema to use hash as primary key
export async function initDb() {
  if (!db) {
    db = new PGlite("memory://");
    await db.waitReady;

    // Recreate table with hash as primary key
    await db.query(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        timespan TEXT,
        mode TEXT,
        format TEXT,
        sort TEXT,
        maxrecords INT
      )
    `);
  }
  return db;
}

// Fetch all ColumnDefinition rows
export async function getColumns(): Promise<(ColumnDefinition & { id: string })[]> {
  const database = await initDb();
  const result = await database.query("SELECT * FROM columns");
  return result.rows.map(row => ({
    id: row.id,
    query: row.query,
    timespan: row.timespan ?? undefined,
    mode: row.mode ?? undefined,
    format: row.format ?? undefined,
    sort: row.sort ?? undefined,
    maxrecords: row.maxrecords ?? undefined,
  }));
}

// Update addColumn to use hash and handle duplicates
export async function addColumn(
  columnDef: ColumnDefinition
): Promise<string> {
  const database = await initDb();
  const id = hashQuery(columnDef.query);
  
  // Use upsert to handle duplicates gracefully
  await database.query(
    `
    INSERT INTO columns (id, query, timespan, mode, format, sort, maxrecords)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      timespan = $3,
      mode = $4,
      format = $5,
      sort = $6,
      maxrecords = $7
    `,
    [
      id,
      columnDef.query,
      columnDef.timespan ?? null,
      columnDef.mode ?? null,
      columnDef.format ?? null,
      columnDef.sort ?? null,
      columnDef.maxrecords ?? null
    ]
  );
  
  return id;
}

// Update other functions to use string IDs
export async function updateColumn(
  id: string,
  columnDef: ColumnDefinition
): Promise<void> {
  const database = await initDb();
  await database.query(
    `
    UPDATE columns 
    SET query = $1, timespan = $2, mode = $3, format = $4, sort = $5, maxrecords = $6
    WHERE id = $7
    `,
    [
      columnDef.query,
      columnDef.timespan ?? null,
      columnDef.mode ?? null,
      columnDef.format ?? null,
      columnDef.sort ?? null,
      columnDef.maxrecords ?? null,
      id
    ]
  );
}

export async function deleteColumn(id: string): Promise<void> {
  const database = await initDb();
  await database.query('DELETE FROM columns WHERE id = $1', [id]);
} 