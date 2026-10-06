// @vitest-environment jsdom
//
// #2386. A WebView page reload throws the JS side away but the native SQLite plugin keeps the
// `trainingai` connection the old page opened. The new page's SQLiteConnection starts with an
// empty JS connection map, and the plugin's `isConnection()` reads only that map, so the old
// guard never saw the leftover: `createConnection` threw "already exists" and every reload went
// down the poisoned-migration fallback. Right after, two local-store transactions interleaved on
// the one native connection ("Already in transaction", then "no current transaction").
//
// The fake plugin below keeps native state in a module-level object that outlives a page (a fresh
// sqlite-service import), the way the real plugin outlives a reload, and mirrors the pinned
// 8.1.0 behaviour: isConnection is JS-only, checkConnectionsConsistency with an empty JS map
// closes every native connection, and the native connection has one transaction slot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const native = {
  conns: new Set<string>(),
  inTransaction: false,
  log: [] as string[],
}

const open = vi.fn()
const execute = vi.fn()
const createConnection = vi.fn()

function fakeDb() {
  return {
    open,
    execute,
    query: vi.fn(async () => ({ values: [{ journal_mode: 'wal' }] })),
    run: vi.fn(async (sql: string, _values: unknown[], transaction: boolean) => {
      native.log.push(`run ${sql} tx=${transaction}`)
    }),
    beginTransaction: vi.fn(async () => {
      if (native.inTransaction) throw new Error('BeginTransaction: Failed in beginTransaction Already in transaction')
      native.inTransaction = true
      native.log.push('BEGIN')
    }),
    commitTransaction: vi.fn(async () => {
      if (!native.inTransaction) throw new Error('CommitTransaction: no current transaction')
      native.inTransaction = false
      native.log.push('COMMIT')
    }),
    rollbackTransaction: vi.fn(async () => {
      if (!native.inTransaction) throw new Error('RollbackTransaction: no current transaction')
      native.inTransaction = false
      native.log.push('ROLLBACK')
    }),
  }
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    // The JS-side map: empty in every new page, exactly like the real wrapper.
    private js = new Set<string>()
    addUpgradeStatement = vi.fn(async () => undefined)
    isConnection = vi.fn(async (name: string) => ({ result: this.js.has(name) }))
    checkConnectionsConsistency = vi.fn(async () => {
      if (this.js.size === 0) {
        // Native closeAllConnections: closing ends any transaction the dead page left open.
        native.conns.clear()
        native.inTransaction = false
        return { result: false }
      }
      return { result: true }
    })
    closeConnection = vi.fn(async (name: string) => {
      if (!native.conns.has(name)) throw new Error(`No available connection for database ${name}`)
      native.conns.delete(name)
      this.js.delete(name)
    })
    constructor() {
      createConnection.mockImplementation(async (name: string) => {
        if (native.conns.has(name)) throw new Error(`CreateConnection: Connection ${name} already exists`)
        native.conns.add(name)
        this.js.add(name)
        return fakeDb()
      })
    }
    createConnection = (...args: unknown[]) => createConnection(...args)
  },
}))

vi.mock('../migrations', () => ({ MIGRATIONS: [], RECONCILE_TABLES: [], RECONCILE_COLUMNS: [] }))

const UPGRADES = [{ toVersion: 1, statements: [] }, { toVersion: 7, statements: [] }]

async function freshPage() {
  vi.resetModules()
  return import('../sqlite-service')
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  native.conns.clear()
  native.inTransaction = false
  native.log = []
  open.mockReset().mockResolvedValue(undefined)
  execute.mockReset().mockResolvedValue(undefined)
  createConnection.mockReset()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks() })

const tookUpgradeFallback = () =>
  errorSpy.mock.calls.some(c => String(c[0]).includes('version upgrade failed'))

describe('initSQLite after a page reload (#2386)', () => {
  it('reopens at the real schema version without the upgrade-failure fallback', async () => {
    // The previous page opened the DB and was reloaded mid-transaction: native still holds both.
    native.conns.add('trainingai')
    native.inTransaction = true

    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)

    expect(tookUpgradeFallback()).toBe(false)
    expect(createConnection).toHaveBeenCalledTimes(1)
    expect(createConnection.mock.calls[0][3]).toBe(7)   // versioned open, not the version-1 reopen
    expect(execute.mock.calls.some(c => String(c[0]).includes('user_version'))).toBe(false)

    // The old page's abandoned transaction does not block the new page's first one.
    await svc.withTransaction(() => svc.runSQL('INSERT INTO x VALUES (1)'))
    expect(native.log).toEqual(['BEGIN', 'run INSERT INTO x VALUES (1) tx=false', 'COMMIT'])
  })

  it('a cold start with nothing native left over opens the same way', async () => {
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)
    expect(tookUpgradeFallback()).toBe(false)
    expect(createConnection).toHaveBeenCalledTimes(1)
    expect(createConnection.mock.calls[0][3]).toBe(7)
  })

  it('still takes the fallback for a genuinely failed upgrade, and stamps the version after reconcile', async () => {
    open.mockRejectedValueOnce(new Error('duplicate column name: attempts'))
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)

    expect(tookUpgradeFallback()).toBe(true)
    expect(createConnection).toHaveBeenCalledTimes(2)
    expect(createConnection.mock.calls[1][3]).toBe(1)
    expect(execute.mock.calls.some(c => String(c[0]) === 'PRAGMA user_version = 7;')).toBe(true)
    expect(svc.isLocalStoreDead()).toBe(false)
  })
})

describe('withTransaction queues local-store transactions (#2386)', () => {
  const tick = () => new Promise(r => setTimeout(r, 0))

  it('runs two overlapping transactions one after the other, both committed', async () => {
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)

    // Two pulls landing together, each yielding mid-body the way applyDeltaBody does.
    const a = svc.withTransaction(async () => {
      await svc.runSQL('A1'); await tick(); await svc.runSQL('A2')
    })
    const b = svc.withTransaction(async () => {
      await svc.runSQL('B1'); await tick(); await svc.runSQL('B2')
    })
    await Promise.all([a, b])

    expect(native.log).toEqual([
      'BEGIN', 'run A1 tx=false', 'run A2 tx=false', 'COMMIT',
      'BEGIN', 'run B1 tx=false', 'run B2 tx=false', 'COMMIT',
    ])
  })

  it('a failed transaction rolls back only itself, and the next one still runs', async () => {
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)

    const a = svc.withTransaction(async () => {
      await svc.runSQL('A1'); await tick(); throw new Error('disk I/O')
    })
    const b = svc.withTransaction(() => svc.runSQL('B1'))
    await expect(a).rejects.toThrow('disk I/O')
    await b

    expect(native.log).toEqual(['BEGIN', 'run A1 tx=false', 'ROLLBACK', 'BEGIN', 'run B1 tx=false', 'COMMIT'])
  })

  it('a BEGIN that fails rolls nothing back — it never owned a transaction', async () => {
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)
    native.inTransaction = true   // someone else's transaction is open on the native slot

    await expect(svc.withTransaction(() => svc.runSQL('A1'))).rejects.toThrow(/SQL failed \[BEGIN\]/)
    expect(native.inTransaction).toBe(true)          // not rolled back from under its owner
    expect(native.log).not.toContain('ROLLBACK')
    expect(native.log.some(l => l.includes('A1'))).toBe(false)

    // The queue is released: the next transaction is not stuck behind the failed one.
    native.inTransaction = false
    await svc.withTransaction(() => svc.runSQL('B1'))
    expect(native.log).toEqual(['BEGIN', 'run B1 tx=false', 'COMMIT'])
  })

  it('returns the body result', async () => {
    const svc = await freshPage()
    await svc.initSQLite(UPGRADES)
    await expect(svc.withTransaction(async () => 42)).resolves.toBe(42)
  })
})
