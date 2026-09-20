// BF-185, the device half — and it is the load-bearing one on the APK.
//
// The server preserves `taken_at` on a re-tick now, but that alone fixes nothing here: the device
// pushes the `taken_at` it read back from its OWN row, and an explicitly-supplied value wins
// server-side. A local store that re-stamped would push the re-stamped time straight over the
// server's preserved one, and the owner's measured 35-minute drift would survive the server fix.
//
// The sibling suites in this folder grep source, because `getLocalStore` returns null under node
// and there is no local SQLite to drive. That reasoning has an escape hatch: the SQL is a plain
// string, and `node:sqlite` will execute it. So this runs the SHIPPED statement — extracted from
// `sqlite-backend.ts` rather than copied into the test — against a real table built from the
// migration's own DDL. A change to that SQL changes what this test runs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const backend = readFileSync(join(process.cwd(), 'lib/local-store/sqlite-backend.ts'), 'utf8')

/** The body of a named method, so a match cannot be satisfied by a different one in the file. */
function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, `${signature} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }\n')
  return rest.slice(0, end === -1 ? rest.length : end)
}

const upsertBody = fnBody(backend, 'async upsertSupplementLog(record')

/** The shipped INSERT, still carrying its `${takenAtOnConflict}` placeholder. */
function shippedUpsertSql(): string {
  const start = upsertBody.indexOf('`INSERT INTO supplement_logs')
  expect(start, 'the upsert statement moved').toBeGreaterThan(-1)
  const rest = upsertBody.slice(start + 1)
  const end = rest.indexOf('`')
  expect(end, 'unterminated template').toBeGreaterThan(-1)
  return rest.slice(0, end)
}

/** The two branches of the shipped ternary: [callerStatedTime, callerStatedNothing]. */
function shippedFragments(): [string, string] {
  const m = upsertBody.match(
    /const takenAtOnConflict = callerStatedTime\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/)
  expect(m, 'the takenAtOnConflict ternary moved or changed shape').not.toBeNull()
  return [m![1], m![2]]
}

// Straight from `lib/sqlite/migrations.ts` — the rebuilt table plus the partial unique index that
// makes a re-tick an UPDATE rather than a second row. The index is the whole reason there is a
// conflict clause to get right.
const DDL = [
  `CREATE TABLE supplement_logs (
     id TEXT PRIMARY KEY, supplement_id TEXT NOT NULL, log_date TEXT NOT NULL,
     amount REAL, unit TEXT, dose_text TEXT,
     taken_at TEXT, vial_strength_mg REAL, vial_water_ml REAL, vial_units_per_ml REAL,
     source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT,
     updated_at TEXT NOT NULL, deleted_at TEXT,
     sync_status TEXT NOT NULL DEFAULT 'pending'
   )`,
  `CREATE UNIQUE INDEX idx_supplement_logs_manual_day
     ON supplement_logs (supplement_id, log_date) WHERE source = 'manual'`,
]

const FIRST = '2026-09-20T10:46:33.000Z'
const SECOND = '2026-09-20T11:21:13.000Z'

type Row = { taken_at: string | null; amount: number | null; deleted_at: string | null }

function freshDb() {
  const db = new DatabaseSync(':memory:')
  for (const stmt of DDL) db.exec(stmt)
  return db
}

/** One tick through the shipped statement. `takenAt` is what the local code resolved for THIS tick. */
function tick(db: DatabaseSync, sql: string, takenAt: string, over: Partial<{ amount: number; id: string }> = {}) {
  db.prepare(sql).run(
    over.id ?? 'log-1', 'sup-1', '2026-09-20', over.amount ?? 2, 'mg', null,
    takenAt, null, null, null,
    'manual', null, takenAt, null, 'pending',
  )
}

const read = (db: DatabaseSync): Row =>
  db.prepare(`SELECT taken_at, amount, deleted_at FROM supplement_logs WHERE source='manual'`).get() as Row

describe('the local store keeps the time a dose was taken (BF-185)', () => {
  const [whenStated, whenNotStated] = shippedFragments()
  const sqlNotStated = shippedUpsertSql().replace('${takenAtOnConflict}', whenNotStated)
  const sqlStated = shippedUpsertSql().replace('${takenAtOnConflict}', whenStated)

  it('the extracted statement is the real one, placeholder and all', () => {
    expect(shippedUpsertSql()).toContain('${takenAtOnConflict}')
    expect(shippedUpsertSql()).toContain("ON CONFLICT(supplement_id, log_date) WHERE source = 'manual'")
    // If this ever reads `taken_at=excluded.taken_at` unconditionally again, the two statements
    // below stop differing and every assertion here would pass against the bug.
    expect(sqlNotStated).not.toEqual(sqlStated)
  })

  // The owner's case: tick at 10:46:33, untick, re-tick at 11:21:13. The stamp must not move.
  it('a re-tick with no stated time keeps the original stamp', () => {
    const db = freshDb()
    tick(db, sqlNotStated, FIRST)
    expect(read(db).taken_at).toBe(FIRST)

    db.exec(`UPDATE supplement_logs SET deleted_at='${SECOND}' WHERE source='manual'`)
    tick(db, sqlNotStated, SECOND)

    const row = read(db)
    expect(row.taken_at).toBe(FIRST)
    expect(row.deleted_at).toBeNull()   // the re-tick still revives the row
  })

  // The arm that leaves room for an editable control to say "I dosed at a different time".
  it('a stated time still overwrites the stored one', () => {
    const db = freshDb()
    tick(db, sqlNotStated, FIRST)
    tick(db, sqlStated, SECOND)
    expect(read(db).taken_at).toBe(SECOND)
  })

  it('fills a NULL stamp rather than preserving the emptiness', () => {
    const db = freshDb()
    tick(db, sqlNotStated, FIRST)
    db.exec(`UPDATE supplement_logs SET taken_at=NULL WHERE source='manual'`)
    tick(db, sqlNotStated, SECOND)
    expect(read(db).taken_at).toBe(SECOND)
  })

  // CONTROL — the dose must still re-stamp. A fix that froze the whole row on conflict would pass
  // every assertion above and fail this one.
  it('the DOSE still re-stamps on a re-tick, unlike the time', () => {
    const db = freshDb()
    tick(db, sqlNotStated, FIRST, { amount: 2 })
    tick(db, sqlNotStated, SECOND, { amount: 4 })

    const row = read(db)
    expect(row.amount).toBe(4)
    expect(row.taken_at).toBe(FIRST)
  })

  // `applyDelta` writes rows the device did NOT author, so the server's value is the truth there
  // and it must keep taking `excluded`. Copying this fix into that branch would make a device
  // ignore a correction made anywhere else.
  it('leaves the pull-delta path re-stamping from the server', () => {
    const applyDelta = backend.slice(backend.indexOf('for (const r of delta.supplementLogs'))
    const manualBranch = applyDelta.slice(0, applyDelta.indexOf('\n    }\n'))
    expect(manualBranch).toContain('taken_at=excluded.taken_at')
    expect(manualBranch).not.toContain('COALESCE(supplement_logs.taken_at')
  })
})
