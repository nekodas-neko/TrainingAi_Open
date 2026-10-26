// @vitest-environment jsdom
//
// The window between "the app mounted" and "initSQLite finished opening the DB". On the S25 that
// window is the versioned upgrade + WAL pragma + a full reconcileSchema pass — seconds on the first
// launch after a release that adds a migration. getLocalStore() hands out a LIVE store during it
// (it only screens out the dead store, K4), so a write landing there used to hit `if (!_db) return`
// and vanish: nothing written, nothing queued to the outbox, and the caller's `savedLocally = true`
// suppressed its API fallback behind a success toast. That is how the 2026-08-13 morning check-in
// disappeared with no error logged anywhere.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const run = vi.fn().mockResolvedValue(undefined)
const query = vi.fn().mockResolvedValue({ values: [{ journal_mode: 'wal' }] })
const execute = vi.fn().mockResolvedValue(undefined)
const open = vi.fn()

let native = true

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native,
    isPluginAvailable: () => native,
  },
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    addUpgradeStatement = vi.fn().mockResolvedValue(undefined)
    checkConnectionsConsistency = vi.fn().mockResolvedValue({ result: false })
    closeConnection = vi.fn().mockResolvedValue(undefined)
    createConnection = vi.fn().mockResolvedValue({ open, run, query, execute })
  },
}))

// Keep reconcileSchema cheap — it is not what this test is about.
vi.mock('../migrations', () => ({ MIGRATIONS: [], RECONCILE_TABLES: [], RECONCILE_COLUMNS: [] }))

async function freshService() {
  vi.resetModules()
  return import('../sqlite-service')
}

describe('runSQL during the initSQLite window', () => {
  beforeEach(() => {
    native = true
    run.mockClear()
    open.mockReset().mockResolvedValue(undefined)
  })

  it('waits for an in-flight open instead of dropping the write', async () => {
    const svc = await freshService()
    let releaseOpen: () => void = () => {}
    const opened = new Promise<void>(res => { releaseOpen = res })
    open.mockImplementation(() => opened)

    const init = svc.initSQLite([])
    // The tap lands mid-init, exactly as it does when the sheet opens on a cold app start.
    const write = svc.runSQL('INSERT INTO mood_logs VALUES (?)', ['x'])

    await new Promise(r => setTimeout(r, 20))
    expect(run).not.toHaveBeenCalled()   // still queued behind the open, not silently dropped
    releaseOpen()
    await init
    await write

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toContain('INSERT INTO mood_logs')
  })

  it('throws on the canonical runtime when the DB never opened, so the caller can fall back', async () => {
    const svc = await freshService()
    open.mockRejectedValue(new Error('upgrade failed'))
    await expect(svc.initSQLite([])).rejects.toThrow()

    await expect(svc.runSQL('INSERT INTO mood_logs VALUES (?)', ['x'])).rejects.toThrow(/Local store unavailable/)
    expect(run).not.toHaveBeenCalled()
  })

  it('stays a silent no-op on web, where no store is handed out in the first place', async () => {
    native = false
    const svc = await freshService()
    await expect(svc.runSQL('INSERT INTO mood_logs VALUES (?)', ['x'])).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })
})

// #3435: `querySQL` answers [] for a database that is not open, so a caller that reads "no rows" as
// "nothing to lose" (`deviceHasLocalData`) takes `querySQLOpen`, which throws instead.
describe('querySQLOpen', () => {
  beforeEach(() => {
    native = true
    query.mockClear()
    open.mockReset().mockResolvedValue(undefined)
  })

  it('throws, where querySQL answers [], when init was never started', async () => {
    vi.useFakeTimers()
    try {
      const svc = await freshService()
      await expect(svc.querySQL('SELECT 1')).resolves.toEqual([])
      const read = expect(svc.querySQLOpen('SELECT 1')).rejects.toThrow(/not open/)
      await vi.advanceTimersByTimeAsync(3_100)
      await read
    } finally {
      vi.useRealTimers()
    }
  })

  // #3445: the store-owner check can ask on a first launch before init has been called.
  it('waits briefly for init to begin, then reads, rather than throwing', async () => {
    vi.useFakeTimers()
    try {
      const svc = await freshService()
      query.mockResolvedValue({ values: [{ x: 1 }] })
      const read = svc.querySQLOpen('SELECT 1 AS x')
      await vi.advanceTimersByTimeAsync(500)
      void svc.initSQLite([])
      await vi.advanceTimersByTimeAsync(100)
      await expect(read).resolves.toEqual([{ x: 1 }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not wait when init already failed: that is a known answer, not a late start', async () => {
    const svc = await freshService()
    open.mockRejectedValue(new Error('upgrade failed'))
    await expect(svc.initSQLite([])).rejects.toThrow()
    vi.useFakeTimers()
    try {
      let settled = false
      const read = svc.querySQLOpen('SELECT 1').catch(e => { settled = true; return e })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
      expect((await read).message).toMatch(/not open/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when the DB failed to open', async () => {
    const svc = await freshService()
    open.mockRejectedValue(new Error('upgrade failed'))
    await expect(svc.initSQLite([])).rejects.toThrow()
    await expect(svc.querySQLOpen('SELECT 1')).rejects.toThrow(/not open/)
  })

  it('waits for an in-flight open and then reads', async () => {
    const svc = await freshService()
    query.mockResolvedValue({ values: [{ x: 1 }] })
    let releaseOpen: () => void = () => {}
    const opened = new Promise<void>(res => { releaseOpen = res })
    open.mockImplementation(() => opened)
    const init = svc.initSQLite([])
    const read = svc.querySQLOpen('SELECT 1 AS x')
    releaseOpen()
    await init
    await expect(read).resolves.toEqual([{ x: 1 }])
  })
})
