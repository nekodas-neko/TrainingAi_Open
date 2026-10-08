// Issue 2661. `computeAchievements` read five soft-deleted tables without `deleted_at IS NULL`, so a
// deleted food log, weigh-in, step entry or run still earned progress — while the workout queries in
// the same function already filtered. The pattern was applied unevenly, and nothing noticed.
//
// This is a DISCOVERY scan, not a list of the tables that were wrong: the soft-deleted tables are
// read off `schema.ts` (a table with a `deleted_at` column), and every `FROM` / `JOIN` of one inside
// `lib/achievements.ts` must carry its own tombstone predicate. A table that gains `deleted_at`
// later, or a new achievement query, is caught without anyone remembering to add it here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Tables declared with a `deleted_at` column in the Drizzle schema. */
function softDeletedTables(): string[] {
  const schema = read('lib/data/postgres/schema.ts')
  const out: string[] = []
  const decl = /pgTable\(\s*'([a-z_]+)'/g
  const starts = [...schema.matchAll(decl)]
  starts.forEach((m, i) => {
    const body = schema.slice(m.index!, starts[i + 1]?.index ?? schema.length)
    if (/timestamp\(\s*'deleted_at'/.test(body)) out.push(m[1])
  })
  return out
}

const NOT_AN_ALIAS = new Set(['WHERE', 'ON', 'GROUP', 'ORDER', 'LEFT', 'INNER', 'JOIN', 'LIMIT', 'AS', 'USING'])

/** Every `FROM|JOIN table [alias]` in one SQL template, with the tombstone predicate it needs. */
function tableReads(sqlText: string, tables: Set<string>) {
  const reads: Array<{ table: string; alias: string | null; ok: boolean }> = []
  for (const m of sqlText.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?([A-Za-z_]+))?/g)) {
    if (!tables.has(m[1])) continue
    const alias = m[2] && !NOT_AN_ALIAS.has(m[2].toUpperCase()) ? m[2] : null
    // A bare predicate is accepted only for an unaliased read; an aliased one must name its alias,
    // otherwise `ws.deleted_at IS NULL` would satisfy a read of a different table.
    const ok = alias
      ? new RegExp(`\\b${alias}\\.deleted_at IS NULL`).test(sqlText)
      : /(?<![.\w])deleted_at IS NULL/.test(sqlText)
    reads.push({ table: m[1], alias, ok })
  }
  return reads
}

const SOURCE = stripComments(read('lib/achievements.ts'))
const templates = [...SOURCE.matchAll(/db\.execute\(\s*sql`([\s\S]*?)`\s*\)/g)].map(m => m[1])

describe('computeAchievements skips deleted entries (issue 2661)', () => {
  const tables = new Set(softDeletedTables())

  it('finds the soft-deleted tables and the queries at all — a scan that matches nothing passes silently', () => {
    // Floors, not targets. Lower one only when a table or query genuinely goes.
    expect(tables.size).toBeGreaterThanOrEqual(10)
    for (const t of ['food_logs', 'body_metrics', 'activity_logs', 'workout_sessions', 'exercise_logs']) {
      expect(tables.has(t), `${t} should be discovered as soft-deleted`).toBe(true)
    }
    expect(templates.length).toBeGreaterThanOrEqual(14)
  })

  it('every read of a soft-deleted table filters its tombstone', () => {
    const missing = templates.flatMap(t =>
      tableReads(t, tables).filter(r => !r.ok).map(r => `${r.table}${r.alias ? ` ${r.alias}` : ''}`))
    expect(missing, `achievement queries reading soft-deleted tables without \`deleted_at IS NULL\`: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('actually sees the reads it is meant to police', () => {
    // Control: the workout queries already filtered, and the five from the issue are the ones that
    // did not. If the scan stopped seeing them, "no offenders" above would mean nothing.
    const seen = templates.flatMap(t => tableReads(t, tables).map(r => r.table))
    for (const t of ['food_logs', 'body_metrics', 'activity_logs', 'workout_sessions', 'exercise_logs']) {
      expect(seen, `${t} is read by an achievement query`).toContain(t)
    }
    expect(seen.filter(t => t === 'food_logs').length).toBe(2)
    expect(seen.filter(t => t === 'body_metrics').length).toBe(3)
  })

  it('catches the shape it exists for (control)', () => {
    const bad = 'SELECT COUNT(*) FROM food_logs fl WHERE fl.user_id = $1'
    expect(tableReads(bad, new Set(['food_logs']))).toEqual([{ table: 'food_logs', alias: 'fl', ok: false }])
    // The wrong alias's predicate must not satisfy a read of a different table.
    const crossed = 'SELECT 1 FROM workout_sessions ws JOIN food_logs fl ON fl.id = ws.id WHERE ws.deleted_at IS NULL'
    expect(tableReads(crossed, new Set(['workout_sessions', 'food_logs'])).map(r => r.ok)).toEqual([true, false])
  })
})
