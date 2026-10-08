// @vitest-environment jsdom
/**
 * Issue 2169: the "Import more history" row on Data & Sync. The engine (`importMoreHistory`) is
 * mocked; its own tests cover the paging. These cover what the row shows and does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const native = vi.hoisted(() => ({ on: true }))
const eng = vi.hoisted(() => ({
  oldest: null as string | null,
  fetchFails: false,
  run: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const cache = vi.hoisted(() => ({
  invalidateBiometrics: vi.fn(async () => {}),
  invalidateActivityWrites: vi.fn(async () => {}),
  invalidatePulledDomains: vi.fn(async () => {}),
}))
const pullDelta = vi.hoisted(() => vi.fn(async () => ({ synced: 4, domains: {}, hasMore: false })))
const restore = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ synced: 9, failed: false, domains: {} }) as { synced: number; failed: boolean; domains: object } | null))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/cache-groups', () => cache)
vi.mock('@/lib/local-store/sync-engine', () => ({ pullDelta, restoreFromCloud: restore }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/lib/health-connect-history-import', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/health-connect-history-import')>()
  return {
    ...real,
    fetchHistoryOldest: async () => { if (eng.fetchFails) throw new Error('x'); return eng.oldest },
    importMoreHistory: (...a: unknown[]) => eng.run(...a),
  }
})

import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { HistoryImportRow } from '../history-import-row'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const text = () => container.textContent ?? ''
const btn = () => container.querySelector('button') as HTMLButtonElement | null
const click = async () => { await act(async () => { btn()?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }); await flush() }
const mount = async (userId: string | undefined = 'u1') => {
  await act(async () => { root.render(createElement(HistoryImportRow, { userId })) })
  await flush()
}

beforeEach(() => {
  native.on = true
  eng.oldest = null
  eng.fetchFails = false
  eng.run.mockReset()
  Object.values(toast).forEach(f => f.mockReset())
  Object.values(cache).forEach(f => f.mockClear())
  pullDelta.mockClear()
  restore.mockClear()
  restore.mockImplementation(async () => ({ synced: 9, failed: false, domains: {} }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('HistoryImportRow', () => {
  it('renders nothing on the web build, where Health Connect does not exist', async () => {
    native.on = false
    await mount()
    expect(btn()).toBeNull()
  })

  it('offers the action with a plain prompt before any import', async () => {
    await mount()
    expect(text()).toContain('Import more history')
    expect(text()).toContain('30 days at a time')
  })

  it('shows where the account got to - "Imported to 12 Jun" - and offers to go further', async () => {
    eng.oldest = '2026-06-12'
    await mount()
    expect(text()).toContain('Imported to 12 Jun')
    expect(text()).toContain('Tap to go 30 days further')
  })

  it('falls back to the prompt when reading the stored day fails', async () => {
    eng.fetchFails = true
    await mount()
    expect(text()).toContain('30 days at a time')
  })

  it('while running, becomes "Stop importing" with live progress, and a second tap stops the run', async () => {
    let stopFlag: () => boolean = () => false
    let progress: (d: string) => void = () => {}
    let finish: (v: unknown) => void = () => {}
    eng.run.mockImplementation((o: { shouldStop(): boolean; onProgress(d: string): void }) => {
      stopFlag = o.shouldStop
      progress = o.onProgress
      return new Promise(r => { finish = r })
    })
    await mount()
    await click()
    expect(text()).toContain('Stop importing')
    expect(text()).toContain('Importing...')

    await act(async () => { progress('2026-08-11') })
    expect(text()).toContain('reached 11 Aug')

    expect(stopFlag()).toBe(false)
    await click() // second tap = stop
    expect(stopFlag()).toBe(true)

    await act(async () => { finish({ oldest: '2026-08-11', windows: 1, end: 'stopped' }) })
    await flush()
    expect(text()).toContain('Import more history')
    expect(text()).toContain('Imported to 11 Aug')
    expect(toast.success).toHaveBeenCalledWith('Stopped. Imported to 11 Aug.')
  })

  it('on completion, drops the derived caches and pulls the new rows to the device', async () => {
    eng.run.mockResolvedValue({ oldest: '2026-05-01', windows: 3, end: 'exhausted' })
    await mount()
    await click()
    expect(toast.success).toHaveBeenCalledWith('Imported to 1 May. Health Connect has nothing older.')
    expect(cache.invalidateBiometrics).toHaveBeenCalled()
    expect(cache.invalidateActivityWrites).toHaveBeenCalled()
    expect(pullDelta).toHaveBeenCalledWith('u1', true)
    expect(cache.invalidatePulledDomains).toHaveBeenCalled()
  })

  it('does not touch caches or pull when nothing was imported', async () => {
    eng.run.mockResolvedValue({ oldest: null, windows: 0, end: 'exhausted' })
    await mount()
    await click()
    expect(cache.invalidateBiometrics).not.toHaveBeenCalled()
    expect(pullDelta).not.toHaveBeenCalled()
  })

  it('a failed run is an error toast that says to press again, and the row is usable again', async () => {
    eng.run.mockResolvedValue({ oldest: '2026-07-01', windows: 1, end: 'failed', error: 'sync-health 500: boom' })
    await mount()
    await click()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(String(toast.error.mock.calls[0][0])).toContain('Press again to continue.')
    expect(text()).toContain('Import more history')
    expect(btn()?.disabled).toBe(false)
  })

  it('a thrown engine error is reported, not swallowed', async () => {
    eng.run.mockRejectedValue(new Error('plugin gone'))
    await mount()
    await click()
    expect(toast.error).toHaveBeenCalledWith('Import failed: plugin gone', { duration: 15000 })
    expect(text()).toContain('Import more history')
  })

  // Issue 2713: past the ordinary pull's 90 days, the imported span is restored to the device.
  describe('restore of the imported span (issue 2713)', () => {
    const farBack = '2020-01-01'

    it('runs the restore pull once, from the start of this run, when the import went past 90 days', async () => {
      eng.run.mockResolvedValue({ oldest: farBack, windows: 4, end: 'exhausted' })
      await mount()
      const before = Date.now()
      await click()
      expect(restore).toHaveBeenCalledTimes(1)
      const [uid, , since] = restore.mock.calls[0] as [string, unknown, string]
      expect(uid).toBe('u1')
      const t = new Date(since).getTime()
      expect(t).toBeLessThanOrEqual(before)
      expect(t).toBeGreaterThan(before - 15 * 60_000) // the run's start, not epoch
      expect(cache.invalidatePulledDomains).toHaveBeenCalledTimes(2) // the ordinary pull and the restore
    })

    it('does not restore when the import stayed inside the ordinary pull window', async () => {
      const recent = shiftDateStr(todayInTz('Australia/Brisbane'), -40)
      eng.run.mockResolvedValue({ oldest: recent, windows: 1, end: 'exhausted' })
      await mount()
      await click()
      expect(restore).not.toHaveBeenCalled()
    })

    it('does not restore when nothing was imported', async () => {
      eng.run.mockResolvedValue({ oldest: farBack, windows: 0, end: 'exhausted' })
      await mount()
      await click()
      expect(restore).not.toHaveBeenCalled()
    })

    it('a failed restore keeps the import result and the stored oldest day, and shows a retryable message', async () => {
      restore.mockResolvedValueOnce({ synced: 0, failed: true, domains: {} })
      eng.run.mockResolvedValue({ oldest: farBack, windows: 4, end: 'exhausted' })
      await mount()
      await click()
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Imported to 1 Jan 2020'))
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(String(toast.error.mock.calls[0][0])).toContain('Tap to retry')
      expect(text()).toContain('Imported to 1 Jan 2020')
      expect(text()).toContain('Tap to retry')
      expect(btn()?.disabled).toBe(false)
    })

    it('the retry restores the same span even when that press imports nothing new, then clears the message', async () => {
      restore.mockResolvedValueOnce({ synced: 0, failed: true, domains: {} })
      eng.run.mockResolvedValueOnce({ oldest: farBack, windows: 4, end: 'exhausted' })
      await mount()
      await click()
      const firstSince = (restore.mock.calls[0] as unknown[])[2] as string

      eng.run.mockResolvedValueOnce({ oldest: farBack, windows: 0, end: 'exhausted' })
      await click()
      expect(restore).toHaveBeenCalledTimes(2)
      const secondSince = (restore.mock.calls[1] as unknown[])[2] as string
      expect(secondSince <= firstSince).toBe(true) // never narrower than the failed span
      expect(text()).not.toContain('Tap to retry')

      // Idempotent: a third press with nothing imported and nothing pending restores nothing.
      eng.run.mockResolvedValueOnce({ oldest: farBack, windows: 0, end: 'exhausted' })
      await click()
      expect(restore).toHaveBeenCalledTimes(2)
    })

    it('a thrown restore is reported as retryable and does not hide the import', async () => {
      restore.mockRejectedValueOnce(new Error('db locked'))
      eng.run.mockResolvedValue({ oldest: farBack, windows: 2, end: 'exhausted' })
      await mount()
      await click()
      expect(toast.success).toHaveBeenCalled()
      expect(String(toast.error.mock.calls[0][0])).toContain('Tap to retry')
    })
  })
})
