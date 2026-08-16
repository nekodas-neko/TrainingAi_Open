// Per-field provenance for the health-metric tables (body_metrics / sleep_sessions /
// oura_daily). Each row carries a `source_map` JSONB — `{ <sql_column>: <source> }` — so a
// merge is decided PER FIELD against that field's own last writer, not one rank for the whole
// row. This fixes the clobber bug (a lower-priority source silently overwriting a manual value)
// WITHOUT the row-level side effect of freezing a field's legitimate single-source updates
// (e.g. logging a manual weight must not stop the ring's HRV or Health Connect's steps from
// updating that same day).
//
// Precedence: manual > scale_ble > oura_ble > oura_cloud > health_connect > unknown(legacy). A
// higher-or-equal source overwrites a field; a strictly-lower source may only fill a NULL, never
// clobber. scale_ble ranks above oura_ble/oura_cloud (a direct scale reading is a real device
// measurement for weight/body-comp fields) but below manual (the user's own entry should still
// be able to override it). One place for the rank — the three upsert helpers import
// `mergeSet`/`initialSourceMap` and never re-implement it (One-Formula-One-Place).

import { sql, type SQL } from 'drizzle-orm'

export const HEALTH_SOURCES = ['health_connect', 'oura_cloud', 'oura_ble', 'scale_ble', 'manual'] as const
export type HealthSource = (typeof HEALTH_SOURCES)[number]

const RANK: Record<HealthSource, number> = {
  health_connect: 1,
  oura_cloud: 2,
  oura_ble: 3,
  scale_ble: 4,
  manual: 5,
}

/** Precedence rank; null/unknown (legacy rows written before provenance existed) rank 0. */
export function sourceRank(source: string | null | undefined): number {
  return source && source in RANK ? RANK[source as HealthSource] : 0
}

/** A `{prop, col}` pair: the Drizzle model property name and its snake_case SQL column. */
export interface SourceColumn {
  prop: string
  col: string
}

// SQL that reads the stored per-field source rank for `<table>.source_map->>'<col>'`.
// Every part is a trusted compile-time constant (table/column names from our schema), so
// sql.raw is safe — there is no user input in this string.
function storedRankSql(table: string, col: string): string {
  return `CASE ${table}.source_map->>'${col}' ` +
    `WHEN 'manual' THEN 5 WHEN 'scale_ble' THEN 4 WHEN 'oura_ble' THEN 3 WHEN 'oura_cloud' THEN 2 WHEN 'health_connect' THEN 1 ELSE 0 END`
}

/**
 * Build the `set` object for an `onConflictDoUpdate` that merges each column against its own
 * stored source, plus the `sourceMap` update. `src`'s rank is inlined as a constant (it is a
 * closed-enum value known at build time). Merge rule per column:
 *   - incoming value NULL           → keep the stored value
 *   - rank(src) >= stored field rank → take the incoming value (equal rank = newer wins)
 *   - otherwise (stored is higher)   → keep the stored value
 * `sourceMap` re-stamps only the columns this write actually won (jsonb_strip_nulls drops the
 * rest, so `existing || {…}` preserves every field the write did not touch).
 */
export function mergeSet(table: string, cols: SourceColumn[], src: HealthSource): Record<string, SQL> {
  const n = sourceRank(src)
  const set: Record<string, SQL> = {}
  for (const { prop, col } of cols) {
    set[prop] = sql.raw(
      `CASE WHEN EXCLUDED.${col} IS NULL THEN ${table}.${col} ` +
      `WHEN (${storedRankSql(table, col)}) <= ${n} THEN EXCLUDED.${col} ` +
      `ELSE ${table}.${col} END`,
    )
  }
  const mapParts = cols.map(({ col }) =>
    `'${col}', CASE WHEN EXCLUDED.${col} IS NOT NULL AND (${storedRankSql(table, col)}) <= ${n} THEN '${src}' END`,
  ).join(', ')
  set['sourceMap'] = sql.raw(
    `COALESCE(${table}.source_map, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(${mapParts}))`,
  )
  return set
}

/**
 * The initial `source_map` for the INSERT (no-conflict) path: `{ <col>: src }` for every column
 * whose value in this row is non-null. `values` is the already-built insert row keyed by Drizzle
 * property name.
 */
export function initialSourceMap(
  cols: SourceColumn[],
  values: Record<string, unknown>,
  src: HealthSource,
): Record<string, HealthSource> {
  const map: Record<string, HealthSource> = {}
  for (const { prop, col } of cols) {
    if (values[prop] != null) map[col] = src
  }
  return map
}
