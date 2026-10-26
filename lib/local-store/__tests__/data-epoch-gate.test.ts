// #3369 — the sync engine asks "is this device behind an admin reset?" before it reads the outbox or
// writes a pulled row, and does neither unless the answer is ok.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const gate = vi.hoisted(() => ({ answer: 'ok' as 'ok' | 'wiped' | 'unknown' }))
vi.mock('../data-epoch', () => ({ verifyDataEpoch: vi.fn(async () => gate.answer) }))

const store = vi.hoisted(() => ({
  getPendingMutations: vi.fn(async () => [] as unknown[]),
  getLastSyncAt: vi.fn(async () => new Date(0)),
  requeueStrandedFoodTombstones: vi.fn(async () => {}),
}))
vi.mock('../index', () => ({
  getLocalStore: () => store,
  isLocalStoreDead: () => false,
}))
vi.mock('../dead-letter-signal', () => ({ reconcileDeadLetters: vi.fn(async () => {}) }))

describe('the sync engine behind the data-epoch gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  })

  it.each(['wiped', 'unknown'] as const)('reads no outbox row and makes no request when the gate says %s', async answer => {
    gate.answer = answer
    const { pushMutations, pullDelta } = await import('../sync-engine')
    expect(await pushMutations('u1')).toBeNull()
    expect(await pullDelta('u1', true)).toBeNull()
    expect(store.getPendingMutations).not.toHaveBeenCalled()
    expect(store.getLastSyncAt).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('goes on to read the outbox and ask the server when the gate says ok', async () => {
    gate.answer = 'ok'
    const { pushMutations, pullDelta, _resetSyncBackoff } = await import('../sync-engine')
    _resetSyncBackoff()
    await pushMutations('u1')
    await pullDelta('u1', true)
    expect(store.getPendingMutations).toHaveBeenCalled()
    expect(fetch).toHaveBeenCalled()
  })
})
