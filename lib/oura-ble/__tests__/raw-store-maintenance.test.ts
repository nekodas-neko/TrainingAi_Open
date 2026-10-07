// #2579 — the device wiring: the prune flag defaults OFF and the OFF path never reaches pruneRaw.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const plugin = {
  getUnrolledRaw: vi.fn(async () => ({ rows: [{ ringTs: 1, tag: 1, eventName: 'ibi', bodyHex: 'aa', measuredAt: 0 }] })),
  markRolledUp: vi.fn(async () => ({ updated: 1 })),
  pruneRaw: vi.fn(async () => ({ deleted: 0 })),
  rawStats: vi.fn(async () => ({ totalRows: 1, unrolledRows: 0, bytes: 10, lowDisk: false })),
}
let pluginAvailable = true
vi.mock('@/lib/oura-ble/plugin', () => ({ getOuraBle: async () => (pluginAvailable ? { plugin } : null) }))

import {
  isRawPruneEnabled, setRawPruneEnabled, maintainOuraRawStore, readRawMaintenanceLog,
  RAW_PRUNE_FLAG_KEY, RAW_MAINT_MIN_INTERVAL_MS,
} from '../raw-store-maintenance'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pluginAvailable = true
  vi.stubGlobal('localStorage', fakeStorage())
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rolledThroughMs: Date.now() }), { status: 200 })))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the prune flag', () => {
  it('is OFF when never set', () => {
    expect(isRawPruneEnabled()).toBe(false)
  })

  it('is ON only for the exact value the switch writes', () => {
    for (const v of ['true', 'yes', '0', ' 1', '']) {
      localStorage.setItem(RAW_PRUNE_FLAG_KEY, v)
      expect(isRawPruneEnabled()).toBe(false)
    }
    setRawPruneEnabled(true)
    expect(isRawPruneEnabled()).toBe(true)
    setRawPruneEnabled(false)
    expect(isRawPruneEnabled()).toBe(false)
  })

  it('is OFF when storage throws, or is missing', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(isRawPruneEnabled()).toBe(false)
    vi.stubGlobal('localStorage', undefined)
    expect(isRawPruneEnabled()).toBe(false)
  })
})

describe('a maintenance pass', () => {
  it('with the flag at its default, marks and logs but never calls pruneRaw', async () => {
    const r = await maintainOuraRawStore({ force: true })
    expect(r?.outcome).toBe('done')
    expect(plugin.markRolledUp).toHaveBeenCalled()
    expect(plugin.pruneRaw).not.toHaveBeenCalled()
    expect(readRawMaintenanceLog()).toHaveLength(1)
  })

  it('calls pruneRaw once the owner has turned the flag on', async () => {
    setRawPruneEnabled(true)
    await maintainOuraRawStore({ force: true })
    expect(plugin.pruneRaw).toHaveBeenCalledTimes(1)
  })

  it('reads the watermark from its own route, with no parameters', async () => {
    await maintainOuraRawStore({ force: true })
    expect(fetch).toHaveBeenCalledWith('/api/oura-ble/rollup-watermark', { cache: 'no-store' })
  })

  it('touches nothing when the watermark route fails', async () => {
    setRawPruneEnabled(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    const r = await maintainOuraRawStore({ force: true })
    expect(r?.outcome).toBe('watermark-error')
    expect(plugin.getUnrolledRaw).not.toHaveBeenCalled()
    expect(plugin.pruneRaw).not.toHaveBeenCalled()
  })

  it('runs at most once per interval unless forced', async () => {
    await maintainOuraRawStore({ force: true })
    expect(await maintainOuraRawStore()).toBeNull()
    expect(plugin.getUnrolledRaw).toHaveBeenCalledTimes(1)
    const log = readRawMaintenanceLog()
    log[log.length - 1].at = Date.now() - RAW_MAINT_MIN_INTERVAL_MS - 1
    localStorage.setItem('ta-oura-ble-raw-maint-diag', JSON.stringify(log))
    expect(await maintainOuraRawStore()).not.toBeNull()
  })

  it('shares one pass between concurrent callers', async () => {
    const [a, b] = await Promise.all([maintainOuraRawStore({ force: true }), maintainOuraRawStore({ force: true })])
    expect(a).toBe(b)
    expect(plugin.getUnrolledRaw).toHaveBeenCalledTimes(1)
  })

  it('records nothing off-device', async () => {
    pluginAvailable = false
    const r = await maintainOuraRawStore({ force: true })
    expect(r?.outcome).toBe('no-plugin')
    expect(readRawMaintenanceLog()).toEqual([])
  })
})
