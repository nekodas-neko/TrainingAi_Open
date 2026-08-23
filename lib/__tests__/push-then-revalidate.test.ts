// `pushThenRevalidate` is the ordering fix for LB-4, and the ordering is the entire point.
//
// A local write invalidates its caches immediately so this device's screens repaint. Every
// `useCachedValue` subscriber wakes on that signal and refetches — while the server still holds
// the PRE-write state. It then re-caches that stale payload, and because nothing invalidates
// again, the stale value stands for the key's full TTL. Home's Energy Balance card read 42 kcal
// high for exactly this reason, one unlogged entry, while the Nutrition tab looked correct because
// it appends optimistically and never consults the cache.
//
// Verified by mutation: dropping the second call fails "revalidates again once the push lands";
// revalidating unconditionally fails both the offline and the nothing-to-push cases.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pushMutationsMock } = vi.hoisted(() => ({ pushMutationsMock: vi.fn() }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: pushMutationsMock }))

describe('pushThenRevalidate', () => {
  beforeEach(() => { pushMutationsMock.mockReset() })

  async function run(pushResult: unknown) {
    const { pushThenRevalidate } = await import('@/lib/local-store/push-then-revalidate')
    const revalidate = vi.fn()
    pushMutationsMock.mockResolvedValue(pushResult)
    pushThenRevalidate('u1', revalidate)
    await vi.waitFor(() => { if (pushMutationsMock.mock.calls.length === 0) throw new Error('not called') })
    // Let the .then chain settle.
    await Promise.resolve(); await Promise.resolve()
    return revalidate
  }

  it('revalidates again once the push lands', async () => {
    const revalidate = await run({ pushed: 2 })
    expect(revalidate).toHaveBeenCalledTimes(1)
  })

  it('does not revalidate when nothing reached the server', async () => {
    // `null` is offline, the 5xx backoff, or every request failing. The server still holds the
    // pre-write state, so a refetch here would re-cache exactly the payload we are trying to evict.
    const revalidate = await run(null)
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('does not revalidate when there was nothing to push', async () => {
    // `pushed: 0` means the outbox was empty — the server state did not change, so the extra
    // refetch would be pure cost.
    const revalidate = await run({ pushed: 0 })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('swallows a rejected push rather than surfacing an unhandled rejection', async () => {
    const { pushThenRevalidate } = await import('@/lib/local-store/push-then-revalidate')
    const revalidate = vi.fn()
    pushMutationsMock.mockRejectedValue(new Error('network'))
    expect(() => pushThenRevalidate('u1', revalidate)).not.toThrow()
    await Promise.resolve(); await Promise.resolve()
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('returns synchronously — the caller has already painted and must not await the network', async () => {
    const { pushThenRevalidate } = await import('@/lib/local-store/push-then-revalidate')
    pushMutationsMock.mockReturnValue(new Promise(() => { /* never settles */ }))
    expect(pushThenRevalidate('u1', vi.fn())).toBeUndefined()
  })
})
