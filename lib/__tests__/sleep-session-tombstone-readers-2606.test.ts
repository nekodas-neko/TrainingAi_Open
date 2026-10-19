// Issue 2606 — a hand-entered night can be removed, and a removal is a `deleted_at` tombstone on
// `sleep_sessions`. A reader that forgets the tombstone resurrects the night the user removed, and
// nothing on the removing screen would show it. This pins the pattern across the tree.
//
// Every statement in app code that touches `sleep_sessions` (Drizzle `.from/.update/.delete/.insert`
// on the table object, or raw SQL naming the table, on the server or in the device's SQLite store)
// must either carry the tombstone in the statement or be listed below with the reason it must not.
// And the set of MODULES doing so is pinned, so a new module reading sleep rows directly fails here
// until someone has decided which of the two it is. Most readers never appear: they go through
// `listSleepSessions` / `getSleepSessions`, which carry the predicate once for everyone.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..')
const SCAN = ['app', 'lib', 'packages', 'components', 'hooks']
const SKIP_DIR = new Set(['node_modules', '.next', '__tests__', '__check_fixture__', 'e2e', 'test-results', 'migrations'])

function walk(dir: string, out: string[] = []): string[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** A statement touching the table: Drizzle on the table object, or SQL naming it (not `sleep_sessions.col`). */
const TOUCH = /\.(?:from|update|delete|insert|innerJoin|leftJoin)\(\s*(?:s|schema)\.sleepSessions\b|\b(?:FROM|JOIN|UPDATE|INTO)\s+sleep_sessions\b(?!\.)/gi
/** How far a statement is read for its predicate. The longest real one (the pull's upsert) fits. */
const WINDOW_LINES = 14
const TOMBSTONE = /deleted_?at/i

interface Hit { file: string; line: number; text: string }

function hits(): Hit[] {
  const out: Hit[] = []
  for (const top of SCAN) {
    for (const f of walk(join(root, top))) {
      const src = stripComments(readFileSync(f, 'utf8'))
      const lines = src.split('\n')
      for (const m of src.matchAll(TOUCH)) {
        const line = src.slice(0, m.index).split('\n').length
        out.push({ file: relative(root, f).split(sep).join('/'), line, text: lines.slice(line - 1, line - 1 + WINDOW_LINES).join('\n') })
      }
    }
  }
  return out
}

/**
 * Statements that must NOT skip a removed night, each with why. `marker` is a string unique to the
 * statement's window, so an entry names one statement, not a whole file.
 */
const ALLOWED: { file: string; marker: string; reason: string }[] = [
  { file: 'lib/data/postgres/slices/oura.ts', marker: 'const rows = await db.selectDistinct({ date: s.sleepSessions.date }).from(s.sleepSessions)',
    reason: 'issue 3099: the night re-score asks which days hold a TOMBSTONED Oura Cloud night, so a delete then a re-create reads as a revision; it reads removed rows on purpose and never shows one' },
  { file: 'lib/local-store/sqlite-backend.ts', marker: "WHERE sync_status = 'synced' AND oura_id LIKE 'ble:%' AND COALESCE(manual_entry, 0) = 0",
    reason: 'issue 2752: the ghost sweep compares every synced ring row with the server id list, which includes tombstones; a tombstoned row the server still holds is never deleted' },
  { file: 'lib/local-store/sqlite-backend.ts', marker: "DELETE FROM sleep_sessions WHERE sync_status = 'synced' AND id IN",
    reason: 'issue 2752: deletes by id the ghosts chosen above, rows whose server copy no longer exists at all' },
  { file: 'lib/data/postgres/adapter.ts', marker: 'gt(s.sleepSessions.updatedAt, effectiveSince)',
    reason: 'the delta pull IS the tombstone channel: a device learns of a removal only because the removed row is sent' },
  { file: 'lib/data/postgres/adapter.ts', marker: 'array_agg(id::text) AS ids FROM sleep_sessions WHERE user_id',
    reason: 'issue 2752 (#2778): the id list the device ghost sweep compares against; a tombstoned row is not a ghost, so its id must be listed. It used to pass only because its window reached the next method\'s predicate' },
  { file: 'lib/data/postgres/adapter.ts', marker: 'NOT EXISTS (SELECT 1 FROM sleep_sessions d',
    reason: 'guards the (user_id, sleep_start) unique key, which a removed row still holds' },
  { file: 'lib/data/postgres/adapter.ts', marker: '.values({ ...(night.id ? { id: night.id } : {}), userId, date: night.date, ...fields, manualEntry: true })',
    reason: 'an insert writes a new live row; it reads nothing' },
  { file: 'lib/data/postgres/adapter.ts', marker: '.where(eq(s.sleepSessions.id, night.id)).limit(1)',
    reason: 'asks whether an id is taken at all, by any row of anyone: a removed row still owns its id' },
  { file: 'lib/data/postgres/slices/oura.ts', marker: 'LEFT JOIN sleep_sessions taken',
    reason: 'issue 2546: asks whether the (user_id, sleep_start) unique key is taken, which a tombstoned row still holds' },
  { file: 'lib/data/postgres/adapter.ts', marker: "if (!row) return 'not_found'",
    reason: 'deleteManualSleepNight explaining a zero-row removal: it must see a removed row to answer already_removed' },
  { file: 'lib/data/postgres/slices/oura.ts', marker: '.insert(s.sleepSessions)',
    reason: 'the device-night upsert; its conflict arm clears deleted_at when it takes over a removed typed night or revives a ring night the rollup tombstoned (issue 2546; both tested)' },
  { file: 'lib/local-store/sqlite-backend.ts', marker: "UPDATE sleep_sessions SET sync_status='synced' WHERE id=?`, [id]",
    reason: 'confirms a sync_status flag by id; a removal must be confirmed like any other write' },
  { file: 'lib/local-store/sqlite-backend.ts', marker: "WHERE id=? AND manual_entry=1`, [id]",
    reason: 'confirms the manual_sleep mutation, which is how a queued removal goes back to synced' },
  { file: 'lib/local-store/sqlite-backend.ts', marker: "UPDATE sleep_sessions SET sync_status='synced' WHERE date=?",
    reason: 'confirms a manual_bedtime flag by date; changes no value a reader sees' },
]

/** Every module that touches sleep_sessions directly. Adding one means deciding which kind it is. */
const MODULES = [
  'lib/achievements.ts',
  'lib/data/postgres/adapter.ts',
  'lib/data/postgres/slices/oura.ts',
  'lib/local-store/sqlite-backend.ts',
]

describe('every statement on sleep_sessions honours the removal tombstone, or says why not (issue 2606)', () => {
  const found = hits()

  it('finds the statements at all, so an empty scan cannot pass', () => {
    expect(found.length).toBeGreaterThanOrEqual(20)
  })

  it('the modules touching sleep_sessions directly are exactly the reviewed ones', () => {
    expect([...new Set(found.map(h => h.file))].sort()).toEqual(MODULES)
  })

  it('each statement carries deleted_at or is allowed with a reason', () => {
    const offenders = found
      .filter(h => !TOMBSTONE.test(h.text))
      .filter(h => !ALLOWED.some(a => a.file === h.file && h.text.includes(a.marker)))
      .map(h => `${h.file}:${h.line}\n${h.text.split('\n').slice(0, 4).join('\n')}`)
    expect(offenders, `these would show a night the user removed:\n\n${offenders.join('\n\n')}`).toEqual([])
  })

  it('every allowance still names a real statement (no stale exemptions)', () => {
    const stale = ALLOWED.filter(a => !found.some(h => h.file === a.file && h.text.includes(a.marker)))
    expect(stale.map(a => `${a.file}: ${a.marker}`)).toEqual([])
  })

  it('the two shared reads every consumer goes through carry the predicate', () => {
    const adapter = readFileSync(join(root, 'lib/data/postgres/adapter.ts'), 'utf8')
    const list = adapter.slice(adapter.indexOf('async listSleepSessions('), adapter.indexOf('return preferDeviceNights(rows)'))
    expect(list).toContain('isNull(s.sleepSessions.deletedAt)')
    const local = readFileSync(join(root, 'lib/local-store/sqlite-backend.ts'), 'utf8')
    const get = local.slice(local.indexOf('async getSleepSessions('), local.indexOf('return preferDeviceNights(rows.map'))
    expect(get).toContain('deleted_at IS NULL')
  })
})
