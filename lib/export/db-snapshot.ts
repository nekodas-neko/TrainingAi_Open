import type { Pool } from 'pg'

/**
 * Core logic for the admin DB snapshot endpoint (Q-530,
 * docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md).
 *
 * Reads `claude_ro` — the same default-deny, per-user-scoped view schema `/api/admin/db-query`
 * already reads through the `claude_readonly` role. No new scoping map is written here: the
 * generator (`scripts/generate-claude-ro-views.js`) is the one authority, and this module reads its
 * OUTPUT (the views) plus its two meta views rather than a second copy of the classification.
 */

/** Tables large enough that a request must opt in to including them (plan §1). */
export const BULK_TABLES = ['oura_raw_samples', 'oura_heartrate', 'rr_intervals', 'error_events'] as const

/** The real ingest-time column each bulk table's `bulk=<days>` trailing window filters on.
 *  `oura_raw_samples.recorded_at` — not `measured_at`, which CLAUDE.md documents as a dead column
 *  and not `ring_timestamp_ds`, which is a ring-epoch counter, not a wall-clock instant. */
const BULK_TIME_COLUMN: Record<(typeof BULK_TABLES)[number], string> = {
  oura_raw_samples: 'recorded_at',
  oura_heartrate: 'timestamp',
  rr_intervals: 'at',
  error_events: 'created_at',
}

export interface TableColumns {
  /** Every public base table's columns, keyed by table name. */
  publicTables: Map<string, string[]>
  /** Every claude_ro view's columns, keyed by view (= table) name. Excludes `_meta_*`. */
  views: Map<string, string[]>
  excludedTables: Set<string>
  withheldColumns: Map<string, Set<string>>
}

/** Reads the catalog + the two meta views. `pg_catalog` is readable by `claude_readonly` for
 *  `public` even though it holds no `SELECT` grant there — verified against production in the
 *  plan's §4 — which is what lets the drift gate run from the readonly connection at all. */
export async function readTableColumns(pool: Pool): Promise<TableColumns> {
  const [publicRows, viewRows, excludedRows, withheldRows] = await Promise.all([
    pool.query<{ table_name: string; column_name: string }>(`
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `),
    pool.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'claude_ro' AND table_name NOT LIKE '\\_meta\\_%'
      ORDER BY table_name, ordinal_position
    `),
    pool.query<{ table_name: string }>('SELECT table_name FROM claude_ro._meta_excluded_tables'),
    pool.query<{ table_name: string; column_name: string }>('SELECT table_name, column_name FROM claude_ro._meta_withheld_columns'),
  ])

  const publicTables = new Map<string, string[]>()
  for (const r of publicRows.rows) {
    if (!publicTables.has(r.table_name)) publicTables.set(r.table_name, [])
    publicTables.get(r.table_name)!.push(r.column_name)
  }
  const views = new Map<string, string[]>()
  for (const r of viewRows.rows) {
    if (!views.has(r.table_name)) views.set(r.table_name, [])
    views.get(r.table_name)!.push(r.column_name)
  }
  const excludedTables = new Set(excludedRows.rows.map(r => r.table_name))
  const withheldColumns = new Map<string, Set<string>>()
  for (const r of withheldRows.rows) {
    if (!withheldColumns.has(r.table_name)) withheldColumns.set(r.table_name, new Set())
    withheldColumns.get(r.table_name)!.add(r.column_name)
  }

  return { publicTables, views, excludedTables, withheldColumns }
}

/**
 * The plan §4 gate: `public base tables − claude_ro views − claude_ro deliberately-excluded = ∅`,
 * column-level. Fails the EXPORT (throws, naming what it found) rather than silently omitting or
 * including something unscoped — the failure has to land on whoever is about to rely on the file,
 * not get buried in a CI run against a different database.
 */
export function checkDrift(cols: TableColumns): void {
  for (const table of cols.publicTables.keys()) {
    if (cols.views.has(table) || cols.excludedTables.has(table)) continue
    throw new Error(
      `Snapshot drift: table "${table}" has no claude_ro view and is not in _meta_excluded_tables. ` +
      `Re-run scripts/generate-claude-ro-views.js and regenerate the migration before exporting.`,
    )
  }
  for (const [table, publicCols] of cols.publicTables) {
    if (cols.excludedTables.has(table)) continue // whole table is denied, no column check needed
    const viewCols = new Set(cols.views.get(table) ?? [])
    const withheld = cols.withheldColumns.get(table) ?? new Set()
    for (const col of publicCols) {
      if (viewCols.has(col) || withheld.has(col)) continue
      throw new Error(
        `Snapshot drift: column "${table}.${col}" is in neither its claude_ro view nor ` +
        `_meta_withheld_columns. Re-run scripts/generate-claude-ro-views.js and regenerate the ` +
        `migration before exporting.`,
      )
    }
  }
}

/** Primary-key column names, in key order, for a `claude_ro` view — read from the PUBLIC table's
 *  catalog entry (the view has no primary key of its own; it mirrors the table's). Every one of the
 *  83 production tables has a primary key (verified in the plan §3.3), so there is no fallback case
 *  to design for — a table with none would need one before it could be paginated safely at all. */
export async function getPrimaryKeyColumns(pool: Pool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ attname: string }>(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [`public.${table}`])
  return rows.map(r => r.attname)
}

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`
}

/**
 * Streams one table's rows via keyset pagination on its primary key — never a single buffered
 * `SELECT *`, which is the defect the plan's §7 found in `/api/export`'s per-table reads (harmless
 * at 26 small tables, an OOM the moment a bulk table is added). `chunkSize` rows per query keeps
 * each query well inside the readonly pool's 10s statement_timeout without touching that setting.
 */
export async function* streamTableRows(
  pool: Pool, table: string, pkCols: string[], chunkSize = 5_000,
  since?: { column: string; date: Date },
): AsyncGenerator<Record<string, unknown>> {
  const cols = pkCols.map(quoteIdent).join(', ')
  let cursor: unknown[] | null = null
  for (;;) {
    const params: unknown[] = cursor ?? []
    const clauses: string[] = []
    if (cursor) clauses.push(`(${cols}) > (${pkCols.map((_, i) => `$${i + 1}`).join(', ')})`)
    if (since) { params.push(since.date); clauses.push(`${quoteIdent(since.column)} >= $${params.length}`) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT * FROM claude_ro.${quoteIdent(table)} ${where} ORDER BY ${cols} LIMIT ${chunkSize}`,
      params,
    )
    for (const row of rows) yield row
    if (rows.length < chunkSize) return
    cursor = pkCols.map(c => rows[rows.length - 1][c])
  }
}

/** The `since` filter for `streamTableRows`, when `table` is a bulk table under a `bulk=<days>`
 *  window. `null` for a non-bulk table or `bulk=all`/`bulk=0` — no window to apply. */
export function bulkWindowFor(table: string, bulk: string | null): { column: string; date: Date } | null {
  if (!(BULK_TABLES as readonly string[]).includes(table)) return null
  if (!bulk || bulk === '0' || bulk === 'all') return null
  const days = Number(bulk)
  if (!Number.isFinite(days) || days <= 0) return null
  const column = BULK_TIME_COLUMN[table as (typeof BULK_TABLES)[number]]
  return { column, date: new Date(Date.now() - days * 86_400_000) }
}

export interface ManifestEntry {
  table: string
  included: boolean
  rowCount: number | null
  reason?: string
}

/** Resolves which tables a request will actually stream, honouring `tables=` and `bulk=`. */
export function resolveRequestedTables(cols: TableColumns, tablesParam: string | null, bulk: string | null): {
  toExport: string[]
  omitted: { table: string; reason: string }[]
} {
  const allViewTables = [...cols.views.keys()].sort()
  const requested = tablesParam
    ? tablesParam.split(',').map(t => t.trim()).filter(Boolean)
    : allViewTables

  const bulkAll = bulk === 'all'
  const bulkDays = bulk && bulk !== 'all' && bulk !== '0' ? Number(bulk) : null

  const toExport: string[] = []
  const omitted: { table: string; reason: string }[] = []
  for (const table of requested) {
    if (!cols.views.has(table)) {
      omitted.push({ table, reason: cols.excludedTables.has(table) ? 'denied (third-party data)' : 'unknown table' })
      continue
    }
    const isBulk = (BULK_TABLES as readonly string[]).includes(table)
    if (isBulk && !bulkAll && bulkDays == null) {
      omitted.push({ table, reason: 'bulk table — pass bulk=all or bulk=<days> to include' })
      continue
    }
    toExport.push(table)
  }
  // The one table that could not round-trip was `push_subscriptions`, dropped by Q-285. The hazard
  // it illustrated is still real for any future table with withheld NOT NULL columns: the view row
  // cannot satisfy them on restore, so the restore script skips such a table via its SKIP_TABLES
  // (plan §5.1). Nothing to do here either way; the streaming path is unaffected.
  return { toExport, omitted }
}
