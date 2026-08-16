import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every local INSERT must supply exactly as many values as it names columns.
 *
 * This is a source-text check rather than a behavioural one on purpose: the failure it guards is
 * invisible to TypeScript (the SQL is a template string and the params are a plain array), invisible
 * to lint, and **cannot be reproduced in this sandbox at all** — `getLocalStore` returns null off
 * device, so no test that goes through the store can execute these statements. It only ever surfaces
 * as a runtime SQLite error on the phone.
 *
 * It has surfaced there. `body_metrics` gained ten body-composition columns with the scale-BLE work,
 * and both of its statements kept their old placeholder counts: the local write had 32 columns
 * against 31 `?`, and the sync-pull had 32 against 29 `?` plus a literal. The pull error is the one
 * the owner saw — `Run: 30 values for 32 columns` — but the write was broken too, which means
 * *every* local body-metric save was failing: weight, steps, macros, water, HRV, resting HR.
 *
 * Adding a column to one of these means adding a `?` and a param in the same edit. This test is what
 * says so out loud.
 */

const SRC = readFileSync(join(process.cwd(), 'lib/local-store/sqlite-backend.ts'), 'utf8')

interface Stmt {
  table: string
  columns: number
  values: number
  line: number
}

/** Every `INSERT INTO <table> (cols…) VALUES (…)` in the backend, with its arity counted. */
function insertStatements(): Stmt[] {
  const out: Stmt[] = []
  const re = /`INSERT INTO (\w+)\s*\n\s*\(([^)]*)\)\s*\n\s*VALUES \(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(SRC)) !== null) {
    const [, table, cols, vals] = m
    const columns = cols.split(',').map(c => c.trim()).filter(Boolean).length
    // A value slot is either a `?` or an inline literal such as `'synced'`.
    const placeholders = (vals.match(/\?/g) ?? []).length
    const literals = vals.split(',').map(v => v.trim()).filter(v => v && !v.includes('?')).length
    out.push({
      table,
      columns,
      values: placeholders + literals,
      line: SRC.slice(0, m.index).split('\n').length,
    })
  }
  return out
}

describe('local INSERT arity', () => {
  const statements = insertStatements()

  it('finds the statements at all — a silent zero would make this test vacuous', () => {
    // If the regex ever stops matching (the SQL gets reformatted, say), every assertion below
    // passes trivially. Pin a floor so that failure is loud.
    expect(statements.length).toBeGreaterThan(25)
    expect(statements.map(s => s.table)).toContain('body_metrics')
  })

  it.each(insertStatements().map(s => [`${s.table} (line ${s.line})`, s] as const))(
    'supplies one value per column — %s',
    (_label, stmt) => {
      expect({ table: stmt.table, columns: stmt.columns, values: stmt.values })
        .toEqual({ table: stmt.table, columns: stmt.columns, values: stmt.columns })
    },
  )

  // The specific regression: both body_metrics statements, named so a future reader sees which
  // pair actually broke rather than a generic arity failure.
  it('both body_metrics statements are balanced — the pair that broke on device', () => {
    const body = statements.filter(s => s.table === 'body_metrics')
    expect(body).toHaveLength(2)
    for (const s of body) expect(s.values).toBe(s.columns)
    // 32 today: 29 data columns + updated_at + deleted_at + sync_status. If this number changes,
    // a column was added — check the params array in the same edit.
    for (const s of body) expect(s.columns).toBe(32)
  })
})
