import { getPool } from "@/lib/data/postgres/client"
import { getRepositoryAsync } from "@/lib/data"
import { getPrimaryKeyColumns, quoteIdent } from "@/lib/export/db-snapshot"
import { EXPORTED, EXCLUDED, SOFT_DELETED, WITHHELD_COLUMNS, type ExportScope } from "@/lib/export/export-map"

/**
 * Full-data takeout: one NDJSON line per row, `{ domain, row }`.
 *
 * Coverage is driven entirely by `EXPORTED` in `./export-map.ts`, which is exhaustive over
 * `schema.ts` and enforced by `scripts/check-export-coverage.js` (Q-288). The two hand-maintained
 * arrays that used to live here are gone: they were the reason 56 tables were missing.
 */

/** Rows per query. Small enough that no single table's chunk is a memory event, large enough that a
 *  60k-row table is ~12 round trips rather than 600. */
const CHUNK = 5_000

function whereFor(scope: ExportScope, table: string): { predicate: string } {
  const soft = SOFT_DELETED[table]
  const softClause = soft ? ` AND t.${quoteIdent(soft)} IS NULL` : ''
  switch (scope.kind) {
    case 'user_id': return { predicate: `t.user_id = $1${softClause}` }
    case 'own_row': return { predicate: `t.id = $1${softClause}` }
    case 'via': return { predicate: `(${scope.predicate})${softClause}` }
  }
}

function strip(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const withheld = WITHHELD_COLUMNS[table]
  if (!withheld) return row
  const out = { ...row }
  for (const col of withheld) delete out[col]
  return out
}

/**
 * One table's rows, by keyset pagination on its primary key.
 *
 * The previous implementation was `pool.query('SELECT * FROM …')` per table, which **buffers the
 * whole result set** — while the route's comment claimed it streamed "rather than buffering the
 * whole export in memory". Only the per-table `ReadableStream` enqueue was ever true. That was
 * harmless across 26 small tables and an OOM the moment a bulk one was added, so it had to be fixed
 * BEFORE coverage, not after: adding `oura_heartrate` on top of the old read would have been
 * strictly worse than the bug it fixed.
 */
async function* streamTable(
  pool: ReturnType<typeof getPool>, table: string, scope: ExportScope, userId: string,
): AsyncGenerator<Record<string, unknown>> {
  const pkCols = await getPrimaryKeyColumns(pool, table)
  if (pkCols.length === 0) {
    // Every production table has one (verified in the Q-530 plan §3.3). Refuse rather than fall
    // back to an unpaginated read, which is the defect this replaces.
    throw new Error(`export: "${table}" has no primary key, so it cannot be paginated safely`)
  }
  const cols = pkCols.map(quoteIdent).map(c => `t.${c}`).join(', ')
  const { predicate } = whereFor(scope, table)
  let cursor: unknown[] | null = null
  for (;;) {
    const params: unknown[] = [userId]
    let keyset = ''
    if (cursor) {
      const placeholders = cursor.map((_, i) => `$${params.length + i + 1}`).join(', ')
      params.push(...cursor)
      keyset = ` AND (${cols}) > (${placeholders})`
    }
    const { rows } = await pool.query(
      `SELECT t.* FROM public.${quoteIdent(table)} t WHERE ${predicate}${keyset} ORDER BY ${cols} LIMIT ${CHUNK}`,
      params,
    )
    for (const row of rows) yield strip(table, row)
    if (rows.length < CHUNK) return
    cursor = pkCols.map(c => rows[rows.length - 1][c])
  }
}

export interface ExportLine { domain: string; row: unknown }

/**
 * The manifest is emitted FIRST, before any row. An incomplete export is worse than none because
 * nothing signals the omission (Q-288) — so the file now says outright what it does not contain and
 * why, instead of leaving the reader to infer completeness from its size.
 */
export function buildManifest(): ExportLine {
  return {
    domain: '_manifest',
    row: {
      exportedTables: Object.keys(EXPORTED).sort(),
      excluded: Object.entries(EXCLUDED)
        .map(([table, x]) => ({ table, category: x.category, reason: x.reason }))
        .sort((a, b) => a.table.localeCompare(b.table)),
      withheldColumns: WITHHELD_COLUMNS,
      note: 'Rows soft-deleted in the app are omitted. Excluded tables are listed above with the reason for each.',
    },
  }
}

export async function* exportUserData(userId: string): AsyncGenerator<ExportLine> {
  const pool = getPool()

  yield buildManifest()

  for (const table of Object.keys(EXPORTED).sort()) {
    for await (const row of streamTable(pool, table, EXPORTED[table], userId)) {
      yield { domain: table, row }
    }
  }

  // Not a table — a repository call that assembles the user's goals. Kept because it was in the
  // export before this change and removing it would be a silent regression in the other direction.
  const repo = await getRepositoryAsync()
  yield { domain: "goals", row: await repo.getUserGoals(userId) }
}
