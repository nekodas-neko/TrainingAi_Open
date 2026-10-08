import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTabLoader, TAB_IMPORT_SLOW_MS, tabImportHungMessage } from '../tab-loader'

/**
 * #2608: the Health tab sat on its loading pulse for a whole device sitting, and nothing said why.
 * `createPreloadedTab` (#2507) swallowed a failed import and had no answer at all for one that never
 * settled. These pin that every way a tab can fail to arrive ends in a state the tab can show and a
 * report, and that a late arrival still wins.
 */
const Screen = () => null
type Mod = { default: typeof Screen }

function setup(load: () => Promise<Mod>) {
  const report = vi.fn<(message: string, error?: unknown) => void>()
  const loader = createTabLoader(load, { name: 'health', report })
  const seen: string[] = []
  loader.subscribe(() => seen.push(loader.getSnapshot().status))
  return { loader, report, seen }
}

describe('#2608: a tab import that never settles', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('is reported once as hung and shown as not loaded, instead of a pulse forever', async () => {
    const { loader, report } = setup(() => new Promise<Mod>(() => {}))
    void loader.preload()
    expect(loader.getSnapshot().status).toBe('loading')

    await vi.advanceTimersByTimeAsync(TAB_IMPORT_SLOW_MS - 1)
    expect(report).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(loader.getSnapshot()).toEqual({ status: 'slow', Screen: null })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toBe(tabImportHungMessage('health', TAB_IMPORT_SLOW_MS))

    // Further preloads (a remount, the idle warm-up) join the same attempt and do not re-report.
    void loader.preload()
    await vi.advanceTimersByTimeAsync(TAB_IMPORT_SLOW_MS * 3)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('still swaps to the screen when a slow import lands after the watchdog', async () => {
    let resolve!: (m: Mod) => void
    const { loader, report } = setup(() => new Promise<Mod>((r) => { resolve = r }))
    void loader.preload()
    await vi.advanceTimersByTimeAsync(TAB_IMPORT_SLOW_MS)
    expect(loader.getSnapshot().status).toBe('slow')

    resolve({ default: Screen })
    await vi.advanceTimersByTimeAsync(0)
    expect(loader.getSnapshot()).toEqual({ status: 'ready', Screen })
    expect(report).toHaveBeenCalledTimes(1) // the hang only
  })

  it('reports nothing for an import that lands in time', async () => {
    const { loader, report } = setup(() => Promise.resolve({ default: Screen }))
    await loader.preload()
    await vi.advanceTimersByTimeAsync(TAB_IMPORT_SLOW_MS * 2)
    expect(loader.getSnapshot()).toEqual({ status: 'ready', Screen })
    expect(report).not.toHaveBeenCalled()
  })
})

describe('#2608: a tab import that rejects', () => {
  it('is reported with the error and shown as failed, not swallowed', async () => {
    const error = new Error('Failed to load chunk /_next/static/chunks/app_health_x.js')
    const { loader, report } = setup(() => Promise.reject(error))
    await loader.preload()
    expect(loader.getSnapshot()).toEqual({ status: 'failed', Screen: null })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toContain('health')
    expect(report.mock.calls[0][0]).toContain(error.message)
    expect(report.mock.calls[0][1]).toBe(error)
  })

  it('stays retryable: the next preload asks again and can succeed', async () => {
    let calls = 0
    const { loader } = setup(() => (++calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve({ default: Screen })))
    await loader.preload()
    expect(loader.getSnapshot().status).toBe('failed')
    await loader.preload()
    expect(calls).toBe(2)
    expect(loader.getSnapshot()).toEqual({ status: 'ready', Screen })
  })

  it('treats a module with no default component as a failure, not as "still loading"', async () => {
    const { loader, report } = setup(() => Promise.resolve({} as Mod))
    await loader.preload()
    expect(loader.getSnapshot().status).toBe('failed')
    expect(report.mock.calls[0][0]).toContain('without a default component')
  })

  it('catches a loader that throws synchronously', async () => {
    const { loader, report } = setup(() => { throw new Error('sync') })
    await loader.preload()
    expect(loader.getSnapshot().status).toBe('failed')
    expect(report).toHaveBeenCalledTimes(1)
  })
})

describe('#2608: the tab renders every state', () => {
  const tab = readFileSync(join(process.cwd(), 'components/shell/preloaded-tab.tsx'), 'utf8')

  it('shows a not-loaded view for failed and slow, and reports through the client error reporter', () => {
    expect(tab).toMatch(/status === "failed" \|\| status === "slow"/)
    expect(tab).toContain('reportClientError(')
    expect(tab).toContain('console.error(')
  })
})
