// RV-172 — the sync pull dropped columns that `applyDelta` then overwrote with NULL.
//
// The invariant, stated once: **`applyDelta` writes `col = excluded.col` unconditionally, so any
// column it writes must actually arrive.** Omitting one from the delta select or the pull mapper
// does not leave the local value alone — it nulls it, on every pull, for ever.
//
// What that cost, measured in the source:
//   · `supplement_logs.taken_at` and the three `vial_*` columns. The vial triple is the FROZEN dose
//     snapshot; `frozenReconstitution` returns null unless all three are present, so history
//     re-rendered against the CURRENT vial — the retroactive rewrite the freeze exists to prevent.
//   · `exercise_logs.exercise_deloaded`. Q-131 added the pull mapper for it and left the SELECT
//     alone, so `Boolean(undefined)` wrote `0` over every synced row. Half fixed, for months.
//
// Source-level, and explicitly NOT a general parser. A general one was attempted first and produced
// false positives — `1rm` splitting into `rm`, `INSERT INTO` tracking bleeding between statements
// so `supplements` inherited `supplement_logs`' columns. A guard that cries wolf is worse than no
// guard, and this repo has paid for that twice (the fetch-once scanner's over-count, the backlog
// parser mis-reading its own entry). The general version is filed as its own entry with those traps
// written down; these are the regressions that actually happened.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const backend = readFileSync(join(process.cwd(), 'lib/local-store/sqlite-backend.ts'), 'utf8')
const engine = readFileSync(join(process.cwd(), 'lib/local-store/sync-engine.ts'), 'utf8')
const adapter = readFileSync(join(process.cwd(), 'lib/data/postgres/adapter.ts'), 'utf8')

/**
 * Source with `//` comment lines removed.
 *
 * Every assertion below greps real source, and a comment EXPLAINING a defect contains the defect's
 * own text — so a note saying "this used to read `toIso(r.updatedAt)`" matches a search for exactly
 * that and fails a test the code passes. That happened three times in one day across this repo
 * (TN-66's prompt guard, RV-143's entry parser, and this file). Stripping comments is the fix;
 * rewording around the guard is not, because the next comment will not know to.
 */
const code = (src: string) => stripComments(src)

/**
 * `applyDeltaBody` only — the pull path. Every table below ALSO has a local-write upsert with its
 * own `excluded` clause, so a whole-file search finds two statements and picking the first by
 * position reads whichever the file happens to list first. Scoping to the function is the
 * discriminator that means something.
 */
const applyDeltaBody = (() => {
  const from = backend.indexOf('private async applyDeltaBody(')
  const to = backend.indexOf('\n  async getFoodLogs(', from)
  expect(from, 'applyDeltaBody found').toBeGreaterThan(-1)
  expect(to, 'applyDeltaBody end found').toBeGreaterThan(from)
  return backend.slice(from, to)
})()

/** The `col = excluded.col` columns of the pull upsert for `<table>`. */
function excludedWrites(table: string): string[] {
  const at = applyDeltaBody.indexOf(`INSERT INTO ${table} (`)
  expect(at, `pull upsert for ${table}`).toBeGreaterThan(-1)
  // The statement ends at the backtick that closes the template and opens the params array.
  // NOT the first backtick after the INSERT: the SQL interpolates `${isMeal ? `…` : `…`}`, whose
  // branches are themselves template literals, and slicing at that nested backtick truncated the
  // statement before `taken_at` — the exact column this file exists to protect.
  const tail = applyDeltaBody.slice(at)
  const close = tail.search(/`,\s*\n\s*\[/)
  expect(close, `end of the ${table} statement`).toBeGreaterThan(-1)
  const stmt = tail.slice(0, close)
  return [...stmt.matchAll(/([a-z_0-9]+)\s*=\s*excluded\.\1\b/g)].map(m => m[1])
}

const camel = (c: string) => c.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())

describe('supplement_logs — the one that lost the frozen dose', () => {
  const written = excludedWrites('supplement_logs')

  it('applyDelta really does write the time and the vial triple from excluded', () => {
    // The premise. If these ever stop being written from `excluded`, the rest of this file is
    // guarding something that no longer happens and should be re-read rather than trusted.
    for (const col of ['taken_at', 'vial_strength_mg', 'vial_water_ml', 'vial_units_per_ml']) {
      expect(written, `applyDelta writes ${col}`).toContain(col)
    }
  })

  it('every column it writes is produced by the pull mapper', () => {
    const start = engine.indexOf('const supplementLogs =')
    const mapper = code(engine.slice(start, engine.indexOf('satisfies LocalSupplementLog', start)))
    const missing = written
      .filter(c => !['id', 'synced', 'sync_status'].includes(c))
      .filter(c => !new RegExp(`\\b${camel(c)}\\s*:`).test(mapper))
    expect(missing, 'pull mapper drops columns applyDelta nulls').toEqual([])
  })

  it('and the server actually sends them', () => {
    const start = adapter.indexOf('id: s.supplementLogs.id')
    const select = code(adapter.slice(start, adapter.indexOf('.from(s.supplementLogs)', start)))
    for (const col of ['takenAt', 'vialStrengthMg', 'vialWaterMl', 'vialUnitsPerMl']) {
      expect(select, `delta select carries ${col}`).toContain(`s.supplementLogs.${col}`)
    }
  })
})

describe('exercise_logs — Q-131 fixed the mapper and left the select', () => {
  it('the mapper reads exerciseDeloaded, so the select must send it', () => {
    // This is the half-fixed shape: a mapper reading a field nothing supplies is not a no-op,
    // because `Boolean(undefined)` is `false` and that gets written.
    expect(code(engine)).toMatch(/exerciseDeloaded:\s*Boolean\(r\.exerciseDeloaded\)/)

    const start = adapter.indexOf('id:                   s.exerciseLogs.id')
    const select = code(adapter.slice(start, adapter.indexOf('.from(s.exerciseLogs)', start)))
    expect(select).toContain('s.exerciseLogs.exerciseDeloaded')
  })

  it('prepTimeSec stays OUT — it has no local column to overwrite', () => {
    // The entry paired it with `exerciseDeloaded`. It is server-only: nothing under
    // `lib/local-store/` names it, so sending it would be payload with no reader, and adding it
    // would look like a fix while changing nothing.
    expect(code(backend)).not.toMatch(/prep_time_sec/)
    expect(code(engine)).not.toMatch(/prepTimeSec/)
  })
})

describe('food_items — the string "undefined" sorted above every date', () => {
  it('the pull reads a timestamp that exists', () => {
    // `toIso` is `String(v)` for a non-Date, and `food_items` has no `updated_at` server-side — so
    // `toIso(r.updatedAt)` stored the literal "undefined", which sorts ABOVE every ISO date under
    // `updated_at DESC` and pinned those rows to the top of offline recent-foods.
    const start = engine.indexOf('satisfies LocalFoodItem')
    const mapper = code(engine.slice(engine.lastIndexOf('const foodItems =', start), start))
    expect(mapper).toContain('toIso(r.createdAt)')
    expect(mapper, 'reads a field the server does not have').not.toMatch(/toIso\(r\.updatedAt\)/)
  })

  it('and the reason it cannot read updatedAt: the column does not exist', () => {
    // Asserted rather than assumed. If `food_items` ever gains `updated_at`, this fails and the
    // mapper above should be repointed at the real column instead of its creation time.
    const schema = readFileSync(join(process.cwd(), 'lib/data/postgres/schema.ts'), 'utf8')
    const start = schema.indexOf('export const foodItems = pgTable')
    const table = schema.slice(start, schema.indexOf('})', start))
    expect(table).not.toMatch(/\bupdatedAt\b/)
  })
})
