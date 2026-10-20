// Issue 2752 — ring nights a device pulled before the rollup stopped re-minting ids (#2749).
//
// Two halves. ① The store's delete, on the REAL schema (every migration and reconcile column) on
// `node:sqlite`: it removes only synced `ble:` rows the server no longer holds, and leaves pending,
// typed, other-source, still-listed and freshly pulled rows alone. ② The sync-engine driver: once per
// install, again on a forced run, never on an empty or failed server read.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const local = { db: null as DatabaseSync | null }
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { local.db!.prepare(sql).run(...(p.map(bindable) as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => local.db!.prepare(sql).all(...(p.map(bindable) as never[]))),
  withTransaction: vi.fn(async (fn: (tx: { run: (sql: string, p?: unknown[]) => Promise<void> }) => Promise<unknown>) => fn({ run: (await import('@/lib/sqlite/sqlite-service')).runSQL })),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

import { MIGRATIONS, RECONCILE_COLUMNS } from '@/lib/sqlite/migrations'
import { SQLiteLocalStore } from '../sqlite-backend'

vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => new SQLiteLocalStore() }))
import { sweepGhostBleSleep } from '../sync-engine'

const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* existing column */ } }
function device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
  return db
}
const ids = () => (local.db!.prepare(`SELECT id FROM sleep_sessions ORDER BY id`).all() as { id: string }[]).map(r => r.id)

const OLD = '2026-10-01T00:00:00.000Z'
const AS_OF = '2026-10-11T00:00:00.000Z'
function seed() {
  const ins = local.db!.prepare(
    `INSERT INTO sleep_sessions (id, date, oura_id, manual_entry, updated_at, sync_status) VALUES (?, ?, ?, ?, ?, ?)`)
  ins.run('ghost-1', '2026-09-30', 'ble:100', 0, OLD, 'synced')          // gone from the server
  ins.run('ghost-2', '2026-10-01', 'ble:200', 0, OLD, 'synced')          // gone from the server
  ins.run('live-1', '2026-09-30', 'ble:100', 0, OLD, 'synced')           // the re-minted copy
  ins.run('tomb-1', '2026-09-29', 'ble:50', 0, OLD, 'synced')            // tombstoned, still listed
  ins.run('pending-1', '2026-10-02', 'ble:300', 0, OLD, 'pending')       // a local edit to lose
  ins.run('manual-1', '2026-10-03', null, 1, OLD, 'synced')              // a typed night
  ins.run('hc-1', '2026-10-04', 'hc:abc', 0, OLD, 'synced')              // another source
  ins.run('fresh-1', '2026-10-10', 'ble:400', 0, '2026-10-10T23:30:00.000Z', 'synced') // pulled after the read
}
const SERVER_IDS = ['live-1', 'tomb-1']

beforeEach(() => { local.db = device(); seed() })

describe('deleteGhostBleSleepRows (①)', () => {
  it('removes only synced ring rows the server no longer holds, read before the cutoff', async () => {
    const n = await new SQLiteLocalStore().deleteGhostBleSleepRows(new Set(SERVER_IDS), new Date('2026-10-10T23:00:00.000Z'))
    expect(n).toBe(2)
    expect(ids()).toEqual(['fresh-1', 'hc-1', 'live-1', 'manual-1', 'pending-1', 'tomb-1'])
  })

  it('removes nothing when every ring row is listed', async () => {
    const all = ['ghost-1', 'ghost-2', 'live-1', 'tomb-1', 'fresh-1']
    expect(await new SQLiteLocalStore().deleteGhostBleSleepRows(new Set(all), new Date(AS_OF))).toBe(0)
    expect(ids()).toHaveLength(8)
  })
})

describe('sweepGhostBleSleep (②)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })
  const serverSays = (body: unknown, ok = true) =>
    fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })

  it('sweeps once, then skips until forced', async () => {
    serverSays({ asOf: AS_OF, ids: SERVER_IDS })
    expect(await sweepGhostBleSleep('u1')).toBe(2)
    expect(ids()).not.toContain('ghost-1')
    // The fresh row is inside the hour margin before asOf, so it is never taken for a ghost.
    expect(ids()).toContain('fresh-1')

    local.db!.prepare(`INSERT INTO sleep_sessions (id, date, oura_id, manual_entry, updated_at, sync_status) VALUES ('ghost-3', '2026-09-28', 'ble:9', 0, ?, 'synced')`).run(OLD)
    expect(await sweepGhostBleSleep('u1')).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await sweepGhostBleSleep('u1', { force: true })).toBe(1)
  })

  it('never reads an empty list as "no nights", and retries after it', async () => {
    serverSays({ asOf: AS_OF, ids: [] })
    expect(await sweepGhostBleSleep('u1')).toBe(0)
    expect(ids()).toHaveLength(8)
    serverSays({ asOf: AS_OF, ids: SERVER_IDS })
    expect(await sweepGhostBleSleep('u1')).toBe(2)
  })

  it('does nothing, and retries later, when the read fails or is malformed', async () => {
    serverSays({ error: 'x' }, false)
    expect(await sweepGhostBleSleep('u1')).toBe(0)
    serverSays({ asOf: 'not a date', ids: SERVER_IDS })
    expect(await sweepGhostBleSleep('u1')).toBe(0)
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await sweepGhostBleSleep('u1')).toBe(0)
    expect(ids()).toHaveLength(8)
    serverSays({ asOf: AS_OF, ids: SERVER_IDS })
    expect(await sweepGhostBleSleep('u1')).toBe(2)
  })
})
