// BF-187 — opening or resuming the app asks the ring to drain, unless the service drained within
// the cooldown. The service decides staleness (`drainIfStale`), so JS only reacts: settle and
// announce when a drain started, nothing otherwise, and nothing at all on an APK too old to have
// the method.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const plugin = {
  drainIfStale: vi.fn(),
  getStatus: vi.fn(async () => ({ draining: false })),
}
vi.mock('@/lib/oura-ble/plugin', () => ({ getOuraBle: vi.fn(async () => ({ plugin })) }))
vi.mock('@/lib/cache-groups', () => ({ invalidateOuraSync: vi.fn(async () => {}) }))
vi.mock('@/lib/oura-ble/rollup-wait', () => ({ waitForRollup: vi.fn(async () => 'moved') }))

beforeEach(() => {
  plugin.drainIfStale.mockReset()
  plugin.getStatus.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})

describe('syncOuraRingIfStale (BF-187)', () => {
  it('asks the service with the open cooldown, and settles after a drain it started', async () => {
    const { syncOuraRingIfStale, OPEN_DRAIN_MAX_AGE_MS } = await import('../sync')
    plugin.drainIfStale.mockResolvedValue({ result: 'started' })
    await syncOuraRingIfStale()
    expect(plugin.drainIfStale).toHaveBeenCalledWith({ maxAgeMs: OPEN_DRAIN_MAX_AGE_MS })
    await vi.waitFor(() => expect(plugin.getStatus).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('does nothing further when the ring drained recently', async () => {
    const { syncOuraRingIfStale } = await import('../sync')
    plugin.drainIfStale.mockResolvedValue({ result: 'fresh' })
    await syncOuraRingIfStale()
    await new Promise(r => setTimeout(r, 50))
    // The settle path reads the rollup state first, immediately; nothing may start it here.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is a quiet no-op on an APK that predates the method', async () => {
    const { syncOuraRingIfStale } = await import('../sync')
    plugin.drainIfStale.mockRejectedValue(new Error('not implemented'))
    await expect(syncOuraRingIfStale()).resolves.toBeUndefined()
  })

  it('is wired to app open and native resume', () => {
    const src = readFileSync(join(process.cwd(), 'components/sync-provider.tsx'), 'utf8')
    expect(src).toMatch(/const drain = \(\) => \{ void syncOuraRingIfStale\(\); \};[\s\S]{0,300}drain\(\);[\s\S]{0,120}App\.addListener\('resume', drain\)/)
  })
})
