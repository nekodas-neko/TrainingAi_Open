// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shouldAutoSync, attemptAutoSync, AUTO_SYNC_INTERVAL_MS, isColmiSyncInFlight } from '@/lib/colmi-ble/auto-sync'

const KEY = 'ta_colmi_last_auto_sync_v1'

describe('shouldAutoSync', () => {
  it('runs when nothing has been recorded', () => {
    // A real epoch, not a small number: 1e6 ms is under the interval, so a toy clock would make
    // "never synced" read as "just synced".
    expect(shouldAutoSync(Date.parse('2026-08-30T10:00:00Z'), 0)).toBe(true)
  })
  it('waits out the interval, then runs', () => {
    const now = 1_000_000
    expect(shouldAutoSync(now, now - AUTO_SYNC_INTERVAL_MS + 1)).toBe(false)
    expect(shouldAutoSync(now, now - AUTO_SYNC_INTERVAL_MS)).toBe(true)
  })
  it('runs when the stored time is in the FUTURE, rather than locking out until it passes', () => {
    const now = Date.parse('2026-08-30T10:00:00Z')
    expect(shouldAutoSync(now, now + 9 * 3_600_000)).toBe(true)
    // A timezone change or an NTP correction moves the clock backwards. Treating that as "too soon"
    // would silently stop syncing for as long as the skew lasts, which is the failure this whole
    // hook exists to prevent.
  })
})

describe('attemptAutoSync', () => {
  beforeEach(() => { window.localStorage.removeItem(KEY) })

  it('does nothing when no ring is paired', async () => {
    const runSync = vi.fn()
    const r = await attemptAutoSync({ now: () => 1e9, isPaired: () => false, runSync })
    expect(r).toBe('not-paired')
    expect(runSync).not.toHaveBeenCalled()
  })

  it('runs once, then reports too-soon inside the interval', async () => {
    const runSync = vi.fn().mockResolvedValue({ ok: true })
    const deps = { now: () => 1e9, isPaired: () => true, runSync }
    expect(await attemptAutoSync(deps)).toBe('ran')
    expect(await attemptAutoSync(deps)).toBe('too-soon')
    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('marks the time even when the sync throws, so a sleeping ring is not retried in a loop', async () => {
    const runSync = vi.fn().mockRejectedValue(new Error('ring not found'))
    const deps = { now: () => 1e9, isPaired: () => true, runSync }
    expect(await attemptAutoSync(deps)).toBe('ran')
    expect(await attemptAutoSync(deps)).toBe('too-soon')
    expect(isColmiSyncInFlight()).toBe(false)
  })

  it('refuses a second attempt while one is still running', async () => {
    let release: () => void = () => {}
    const runSync = vi.fn(() => new Promise<{ ok: boolean }>(res => { release = () => res({ ok: true }) }))
    const deps = { now: () => 1e9, isPaired: () => true, runSync }
    const first = attemptAutoSync(deps)
    expect(isColmiSyncInFlight()).toBe(true)
    expect(await attemptAutoSync(deps)).toBe('busy')
    release()
    await first
    expect(isColmiSyncInFlight()).toBe(false)
  })
})
