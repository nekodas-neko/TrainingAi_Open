// @vitest-environment jsdom
// #3162 — since #3151 a standalone cache write waits for an open sync transaction. cachedFetch used
// to await that write while its request was still registered as in flight, so a second caller for
// the same key joined it, and was then dropped without onData or onError: a stale or blank card on
// resume, for as long as the pull lasted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const held = vi.hoisted(() => ({ release: [] as Array<() => void>, writes: [] as string[] }))
vi.mock('../sqlite-service', () => ({
  isSQLiteAvailable: () => true,
  querySQL: vi.fn(async () => []),
  // Every write waits, as one queued behind a sync pull's open transaction does.
  runSQL: vi.fn((sql: string) => new Promise<void>(resolve => {
    held.writes.push(sql)
    held.release.push(resolve)
  })),
}))

import { cachedFetch } from '../cache'

const ok = (v: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(v) })
const tick = () => new Promise(r => setTimeout(r, 0))
const releaseWrites = () => { for (const release of held.release.splice(0)) release() }

describe('a cached fetch joined while its cache write waits on a sync (#3162)', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    held.release.length = 0; held.writes.length = 0
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })
  afterEach(() => { releaseWrites(); vi.unstubAllGlobals() })

  it('answers both callers while the write is still held', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ kcal: 1534 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = vi.fn()
    const second = vi.fn()

    const a = cachedFetch('budget', '/x', 60, first)
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ kcal: 1534 }))
    await vi.waitFor(() => expect(held.writes.some(sql => sql.includes('INSERT'))).toBe(true))
    // The cache write is still held: the sync has not committed.
    const b = cachedFetch('budget', '/x', 60, second)
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ kcal: 1534 }))

    releaseWrites()
    await Promise.all([a, b])
    releaseWrites()
    expect(first).toHaveBeenLastCalledWith({ kcal: 1534 })
    expect(second).toHaveBeenLastCalledWith({ kcal: 1534 })
  })

  it('answers a caller that joins before the response, while the write is still held', async () => {
    let respond!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(new Promise(r => { respond = r }))
      .mockResolvedValue(ok({ kcal: 1600 })))
    const first = vi.fn()
    const second = vi.fn()
    const a = cachedFetch('joined', '/x', 60, first)
    await tick()
    const b = cachedFetch('joined', '/x', 60, second)
    await tick()
    respond(ok({ kcal: 1534 }))
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ kcal: 1534 }))
    expect(first).toHaveBeenCalledWith({ kcal: 1534 })
    // A third caller during the held write is answered too, not left on a served request.
    const third = vi.fn()
    const c = cachedFetch('joined', '/x', 60, third)
    await vi.waitFor(() => expect(third).toHaveBeenCalled())
    releaseWrites()
    await Promise.all([a, b, c])
  })

  it('still resolves only once its own cache write has landed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ kcal: 1 })))
    let settled = false
    const a = cachedFetch('order', '/x', 60, vi.fn()).then(() => { settled = true })
    await vi.waitFor(() => expect(held.writes.length).toBeGreaterThan(0))
    await tick()
    expect(settled).toBe(false)
    releaseWrites()
    await a
    expect(settled).toBe(true)
  })
})
