// DV-15 — a deleted food came back on the device as "synced" while the server had it gone.
//
// Unlike its source-scanning siblings, this drives the REAL statement: the upsert is extracted from
// `sqlite-backend.ts` at test time and executed against `node:sqlite`, so the test cannot drift
// from the implementation and cannot pass against a copy that has since been edited.
//
// Measured on the S25 (sweep 2, web v1.465.16): a food logged and deleted within ~10 s ended with
// the LOCAL row reading `deleted_at NULL`, `sync_status 'synced'` while the server's
// `/api/nutrition/food-logs` no longer returned it. Lunch showed "Cocoa powder 11 kcal" for over a
// minute, through tab swaps. Because the row is `synced`, nothing pushes it again.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SRC = readFileSync(join(process.cwd(), 'lib/local-store/sqlite-backend.ts'), 'utf8')

/** The upsert `applyDelta` really runs for a table, lifted out of its template literal. */
function upsertSql(table: string): string {
  const start = SRC.indexOf(`INSERT INTO ${table}\n`)
  expect(start, `INSERT INTO ${table} not found`).toBeGreaterThan(-1)
  const end = SRC.indexOf('`', start)
  expect(end).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

const COLS = `id TEXT PRIMARY KEY, date TEXT, meal_type_id TEXT, food_item_id TEXT,
  saved_meal_id TEXT, meal_group_id TEXT, meal_group_name TEXT, quantity_multiplier REAL,
  logged_at TEXT, updated_at TEXT, deleted_at TEXT, sync_status TEXT`

const LOGGED = '2026-09-23T10:30:45.000Z'
const DELETED = '2026-09-23T10:30:55.419Z'

/** The row a pull carries when it was fetched BEFORE the server processed the delete. */
const stalePullArgs = [
  'ff8f28c6', '2026-09-23', 'lunch', 'cocoa', null, null, null, 1, LOGGED, LOGGED, null,
]

function deviceAtTheMomentOfTheRace() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE food_logs (${COLS})`)
  // logged, then deleted locally — the tombstone is written and queued
  db.exec(`INSERT INTO food_logs VALUES
    ('ff8f28c6','2026-09-23','lunch','cocoa',NULL,NULL,NULL,1,'${LOGGED}','${LOGGED}',NULL,'pending')`)
  db.exec(`UPDATE food_logs SET deleted_at='${DELETED}', updated_at='${DELETED}',
           sync_status='pending' WHERE id='ff8f28c6'`)
  // the push succeeds. markFoodLogSynced flips it to synced and KEEPS the row — that is the step
  // that opens the window, because the clobber guard is now satisfied.
  db.exec(`UPDATE food_logs SET sync_status='synced' WHERE id='ff8f28c6'`)
  return db
}

const rowOf = (db: DatabaseSync) =>
  db.prepare(`SELECT deleted_at, sync_status, updated_at FROM food_logs WHERE id='ff8f28c6'`)
    .get() as { deleted_at: string | null; sync_status: string; updated_at: string }

describe('DV-15 — a stale pull must not resurrect a synced tombstone', () => {
  it('keeps the tombstone when a pre-delete row arrives after the push confirmed', () => {
    const db = deviceAtTheMomentOfTheRace()
    expect(rowOf(db).deleted_at).toBe(DELETED)   // the fixture is the real pre-race state

    db.prepare(upsertSql('food_logs')).run(...stalePullArgs)

    const row = rowOf(db)
    expect(row.deleted_at).toBe(DELETED)          // was null before the fix — the whole defect
    expect(row.updated_at).toBe(DELETED)          // and the delete's timestamp is not rolled back
  })

  // The guard must not be bought by breaking the ordinary case, which is the overwhelming majority
  // of what applyDelta does.
  it('still applies a pull to a live row', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE food_logs (${COLS})`)
    db.exec(`INSERT INTO food_logs VALUES
      ('ff8f28c6','2026-09-23','lunch','cocoa',NULL,NULL,NULL,1,'${LOGGED}','${LOGGED}',NULL,'synced')`)

    db.prepare(upsertSql('food_logs')).run(
      'ff8f28c6', '2026-09-23', 'dinner', 'cocoa', null, null, null, 2, LOGGED, DELETED, null,
    )

    const row = db.prepare(`SELECT meal_type_id, quantity_multiplier, updated_at
                            FROM food_logs WHERE id='ff8f28c6'`).get() as Record<string, unknown>
    expect(row.meal_type_id).toBe('dinner')
    expect(row.quantity_multiplier).toBe(2)
    expect(row.updated_at).toBe(DELETED)
  })

  it('still refuses to clobber a PENDING local edit', () => {
    // The original guard, which this change adds to rather than replaces.
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE food_logs (${COLS})`)
    db.exec(`INSERT INTO food_logs VALUES
      ('ff8f28c6','2026-09-23','lunch','cocoa',NULL,NULL,NULL,9,'${LOGGED}','${DELETED}',NULL,'pending')`)

    db.prepare(upsertSql('food_logs')).run(...stalePullArgs)

    const row = db.prepare(`SELECT quantity_multiplier FROM food_logs WHERE id='ff8f28c6'`)
      .get() as { quantity_multiplier: number }
    expect(row.quantity_multiplier).toBe(9)
  })

  // The sweep, asserted rather than described. Nine arms can write deleted_at=excluded.deleted_at
  // and so can clear a tombstone; every one of them needs the clause. The other four delete-bearing
  // arms (workout_sessions, exercise_logs, set_logs, activity_logs) never SET deleted_at in their
  // update arm, so a tombstone they hold survives a stale pull already.
  it('carries the same guard on every arm that can clear a tombstone', () => {
    const body = SRC.slice(SRC.indexOf('private async applyDeltaBody'))
    for (const t of ['body_metrics', 'mood_logs', 'fitness_tests', 'prescribed_runs', 'food_logs',
                     'supplements', 'supplement_logs', 'injuries', 'day_checkins']) {
      // Both conditions, in either order — the two are ANDed, so which is written first changes
      // nothing, and an assertion that fails on a reorder is pinning syntax rather than the rule.
      const clause = body.slice(body.indexOf(`WHERE ${t}.`)).split('`')[0]
      expect(clause, `${t} is missing the clobber guard`).toContain(`${t}.sync_status='synced'`)
      expect(clause, `${t} is missing the tombstone guard`).toContain(`${t}.deleted_at IS NULL`)
    }
  })
})
