// #3369 — the app reacts to the server's 409 on any write by asking whether to wipe.
import { describe, it, expect, vi } from 'vitest'

const handle = vi.hoisted(() => vi.fn(async () => 'wiped'))
vi.mock('@/lib/local-store/data-epoch', () => ({ handleStaleDataEpoch: handle }))

describe('installDataEpochFetchGuard', () => {
  it('passes a 409 data-epoch-stale through and starts the wipe check for the named user; ignores other 409s', async () => {
    const stale = () => new Response(JSON.stringify({ error: 'data-epoch-stale', epoch: 5, userId: 'u-1' }), {
      status: 409, headers: { 'x-data-epoch-stale': '1', 'content-type': 'application/json' },
    })
    const other = () => new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })
    const queue = [stale, other]
    const original = vi.fn(async () => queue.shift()!())
    vi.stubGlobal('window', { fetch: original })
    const { installDataEpochFetchGuard } = await import('../data-epoch-fetch')
    installDataEpochFetchGuard()
    const guarded = (globalThis as unknown as { window: { fetch: typeof fetch } }).window.fetch
    const first = await guarded('/api/sync/push', { method: 'POST' })
    expect(first.status).toBe(409)
    await new Promise(r => setTimeout(r, 0))
    expect(handle).toHaveBeenCalledWith('u-1')
    handle.mockClear()
    await guarded('/api/anything', { method: 'POST' })
    await new Promise(r => setTimeout(r, 0))
    expect(handle).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
