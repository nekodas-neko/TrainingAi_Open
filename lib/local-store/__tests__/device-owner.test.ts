// #3369 (c) — a different account signing in on a device wipes it before anything local is read or synced.
import { describe, it, expect, vi } from 'vitest'
import {
  checkStoreOwner, resolveStoreOwnerMismatch, resolveUnclaimedStore, runCapped, _resetStoreOwnerGate,
  PUSH_BEFORE_WIPE_MS, PUSH_SETTLE_GRACE_MS, sessionPredatesFromAnswer, type OwnerDeps,
} from '../device-owner'

function deps(initial: string | null, over: Partial<OwnerDeps> = {}) {
  const state = { owner: initial, flag: null as string | null, order: [] as string[], clock: 1_000_000 }
  const d: OwnerDeps = {
    now: () => state.clock,
    outboxHoldsEntriesFor: vi.fn(async () => false),   // a new account has nothing queued unless a test says so
    read: () => state.owner,
    write: vi.fn(u => { state.order.push('write'); state.owner = u; return true }),
    hasData: vi.fn(async () => true),
    sessionPredatesOwnerRecord: vi.fn(async () => false),   // a fresh sign-in unless a test says otherwise
    pushOutbox: vi.fn(async () => { state.order.push('push') }),
    readWiped: () => state.flag,
    writeWiped: vi.fn(u => { state.flag = u }),
    wipe: vi.fn(async () => { state.order.push('wipe'); state.owner = null }),   // the wipe clears the record too
    reload: vi.fn(() => { state.order.push('reload') }),
    ...over,
  }
  return { d, state }
}

describe('checkStoreOwner', () => {
  it('does not adopt a device with no record: it reports it unclaimed and records nothing', () => {
    const { d, state } = deps(null)
    expect(checkStoreOwner('new', d)).toBe('unclaimed')
    expect(state.owner).toBeNull()
    expect(d.write).not.toHaveBeenCalled()
  })
  it('ignores an empty user id: nothing is recorded, nothing is gated', () => {
    const { d, state } = deps(null)
    expect(checkStoreOwner('', d)).toBe('ignored')
    expect(d.write).not.toHaveBeenCalled()
    expect(state.owner).toBeNull()
  })
  it('treats a record that holds the empty string as no record', () => {
    const { d } = deps('')
    expect(checkStoreOwner('new', d)).toBe('unclaimed')
  })
  it('the same account keeps its data: a matching record is owned, nothing is read or wiped', () => {
    const { d } = deps('me')
    expect(checkStoreOwner('me', d)).toBe('owned')
    expect(d.write).not.toHaveBeenCalled()
  })
  it('reports a different user id as a mismatch and changes nothing yet', () => {
    const { d, state } = deps('old')
    expect(checkStoreOwner('new', d)).toBe('mismatch')
    expect(state.owner).toBe('old')
  })
})

describe('resolveStoreOwnerMismatch: delete, then re-signup under a new id', () => {
  it('wipes first, claims the device after, then reloads', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps('old')
    await resolveStoreOwnerMismatch('new', d)
    expect(state.order).toEqual(['wipe', 'write', 'reload'])
    expect(state.owner).toBe('new')
  })
  it('does not loop when the record cannot be written: it neither reloads nor wipes twice', async () => {
    _resetStoreOwnerGate()
    const { d } = deps('old', { write: vi.fn(() => false) })
    await resolveStoreOwnerMismatch('new', d)
    await resolveStoreOwnerMismatch('new', d)
    expect(d.wipe).toHaveBeenCalledTimes(1)
    expect(d.reload).not.toHaveBeenCalled()
  })
  it('a failed wipe leaves the store closed and the next call tries again', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps('old', { wipe: vi.fn(async () => { throw new Error('locked') }) })
    await resolveStoreOwnerMismatch('new', d)
    state.clock += 6_000
    await resolveStoreOwnerMismatch('new', d)
    expect(d.wipe).toHaveBeenCalledTimes(2)
    expect(d.reload).not.toHaveBeenCalled()
  })
})

describe('resolveUnclaimedStore: a device that predates the owner record', () => {
  it('an existing signed-in phone updating adopts its rows and outbox: no wipe, no push, one reload', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { sessionPredatesOwnerRecord: vi.fn(async () => true) })
    await resolveUnclaimedStore('me', d)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.pushOutbox).not.toHaveBeenCalled()
    expect(state.owner).toBe('me')
    expect(state.order).toEqual(['write', 'reload'])
  })
  it('a fresh sign-in on a recordless phone with rows pushes its own outbox, wipes, then claims', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null)
    await resolveUnclaimedStore('new', d)
    expect(state.order).toEqual(['push', 'wipe', 'write', 'reload'])
    expect(state.owner).toBe('new')
  })
  it('a fresh sign-in whose push fails still wipes: the old rows are never adopted', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { pushOutbox: vi.fn(async () => { /* best effort: swallowed */ }) })
    await resolveUnclaimedStore('new', d)
    expect(d.wipe).toHaveBeenCalledTimes(1)
    expect(state.owner).toBe('new')
  })
  it('a session look that fails leaves the store closed and unwiped, and the next call asks again', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { sessionPredatesOwnerRecord: vi.fn(async () => { throw new Error('offline') }) })
    await resolveUnclaimedStore('me', d)
    state.clock += 6_000
    await resolveUnclaimedStore('me', d)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.pushOutbox).not.toHaveBeenCalled()
    expect(state.owner).toBeNull()
    expect(d.sessionPredatesOwnerRecord).toHaveBeenCalledTimes(2)
  })
  it('a carried-over session whose record cannot be written does not reload in a loop', async () => {
    _resetStoreOwnerGate()
    const { d } = deps(null, { sessionPredatesOwnerRecord: vi.fn(async () => true), write: vi.fn(() => false) })
    await resolveUnclaimedStore('me', d)
    expect(d.reload).not.toHaveBeenCalled()
    expect(d.wipe).not.toHaveBeenCalled()
  })
  it('a fresh sign-in on an empty recordless phone claims it without a wipe, a push or a reload', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { hasData: vi.fn(async () => false) })
    await resolveUnclaimedStore('new', d)
    expect(d.pushOutbox).not.toHaveBeenCalled()
    expect(d.sessionPredatesOwnerRecord).not.toHaveBeenCalled()
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
    expect(state.owner).toBe('new')
  })
  it('does not adopt when it cannot tell: a failed look leaves the device unclaimed and closed', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { hasData: vi.fn(async () => { throw new Error('locked') }) })
    await resolveUnclaimedStore('new', d)
    expect(state.owner).toBeNull()
    expect(d.wipe).not.toHaveBeenCalled()
    state.clock += 6_000
    await resolveUnclaimedStore('new', d)
    expect(d.hasData).toHaveBeenCalledTimes(2)
  })
  it('a failed wipe claims nothing and the next call tries again', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { wipe: vi.fn(async () => { throw new Error('locked') }) })
    await resolveUnclaimedStore('new', d)
    state.clock += 6_000
    await resolveUnclaimedStore('new', d)
    expect(d.wipe).toHaveBeenCalledTimes(2)
    expect(state.owner).toBeNull()
    expect(d.reload).not.toHaveBeenCalled()
  })
  it('the same account signing in fresh, push failing, keeps its outbox: adopts, never wipes', async () => {
    _resetStoreOwnerGate()
    // First look: the account's entries are there (pending, backoff or failed: any status counts).
    const { d, state } = deps(null, { outboxHoldsEntriesFor: vi.fn(async () => true) })
    await resolveUnclaimedStore('me', d)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(state.owner).toBe('me')
    expect(state.order).toEqual(['write', 'reload'])
  })
  it('entries that sit in retry backoff or are marked failed still count as proof: no wipe, no push needed', async () => {
    _resetStoreOwnerGate()
    // `getPendingMutations` hides these; the check must not, so it asks for a count over every status.
    const holds = vi.fn(async () => true)
    const { d } = deps(null, { outboxHoldsEntriesFor: holds })
    await resolveUnclaimedStore('me', d)
    expect(holds).toHaveBeenCalledWith('me')
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.pushOutbox).not.toHaveBeenCalled()
  })
  it('a new account (nothing in the outbox under its id) pushes, looks again, wipes and claims', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null)
    await resolveUnclaimedStore('new', d)
    expect(d.outboxHoldsEntriesFor).toHaveBeenCalledTimes(2)
    expect(state.order).toEqual(['push', 'wipe', 'write', 'reload'])
  })
  it('entries still queued for the account after the push mean no wipe', async () => {
    _resetStoreOwnerGate()
    const looks = [false, true]
    const { d, state } = deps(null, { outboxHoldsEntriesFor: vi.fn(async () => looks.shift() ?? true) })
    await resolveUnclaimedStore('me', d)
    expect(d.pushOutbox).toHaveBeenCalledTimes(1)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(state.owner).toBe('me')
    expect(state.order).toEqual(['push', 'write', 'reload'])
  })
  it('an outbox look that fails leaves the store closed and unwiped', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { outboxHoldsEntriesFor: vi.fn(async () => { throw new Error('locked') }) })
    await resolveUnclaimedStore('me', d)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.pushOutbox).not.toHaveBeenCalled()
    expect(state.owner).toBeNull()
  })
  it('a push that will not stop blocks the wipe', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { pushOutbox: vi.fn(async () => { throw new Error('did not stop') }) })
    await resolveUnclaimedStore('new', d)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(state.owner).toBeNull()
  })
  it('after a failed session look the next calls inside the backoff do not look again', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { sessionPredatesOwnerRecord: vi.fn(async () => { throw new Error('offline') }) })
    await resolveUnclaimedStore('me', d)
    for (let i = 0; i < 5; i++) await resolveUnclaimedStore('me', d)
    expect(d.hasData).toHaveBeenCalledTimes(1)
    expect(d.sessionPredatesOwnerRecord).toHaveBeenCalledTimes(1)
    state.clock += 6_000
    await resolveUnclaimedStore('me', d)
    expect(d.sessionPredatesOwnerRecord).toHaveBeenCalledTimes(2)
    // The wait doubles with each failure.
    state.clock += 6_000
    await resolveUnclaimedStore('me', d)
    expect(d.sessionPredatesOwnerRecord).toHaveBeenCalledTimes(2)
    state.clock += 5_000
    await resolveUnclaimedStore('me', d)
    expect(d.sessionPredatesOwnerRecord).toHaveBeenCalledTimes(3)
  })
  it('an empty-store claim whose record cannot be written stays closed and does not rescan every call', async () => {
    _resetStoreOwnerGate()
    const { d } = deps(null, { hasData: vi.fn(async () => false), write: vi.fn(() => false) })
    for (let i = 0; i < 4; i++) await resolveUnclaimedStore('me', d)
    expect(d.hasData).toHaveBeenCalledTimes(1)
    expect(d.reload).not.toHaveBeenCalled()
  })
  it('an adopt whose record cannot be written stays closed, wipes nothing and does not loop', async () => {
    _resetStoreOwnerGate()
    const { d } = deps(null, { outboxHoldsEntriesFor: vi.fn(async () => true), write: vi.fn(() => false) })
    for (let i = 0; i < 4; i++) await resolveUnclaimedStore('me', d)
    expect(d.outboxHoldsEntriesFor).toHaveBeenCalledTimes(1)
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
  })
  it('a success clears the backoff', async () => {
    _resetStoreOwnerGate()
    let fail = true
    const { d, state } = deps(null, { hasData: vi.fn(async () => { if (fail) throw new Error('x'); return false }) })
    await resolveUnclaimedStore('me', d)
    fail = false
    state.clock += 6_000
    await resolveUnclaimedStore('me', d)
    expect(state.owner).toBe('me')
  })
  it('does nothing for an empty user id', async () => {
    _resetStoreOwnerGate()
    const { d } = deps(null)
    await resolveUnclaimedStore('', d)
    await resolveStoreOwnerMismatch('', d)
    expect(d.hasData).not.toHaveBeenCalled()
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.write).not.toHaveBeenCalled()
  })
})

describe('runCapped: the push before a wipe never runs alongside it', () => {
  it('lets a push that finishes in time run to the end, with no abort', async () => {
    vi.useFakeTimers()
    try {
      let aborted = false
      const p = runCapped(async signal => {
        await new Promise(r => setTimeout(r, 1_000))
        aborted = signal.aborted
      })
      await vi.advanceTimersByTimeAsync(1_000)
      await p
      expect(aborted).toBe(false)
    } finally { vi.useRealTimers() }
  })
  it('aborts at the cap and waits for the push to stop before it resolves', async () => {
    vi.useFakeTimers()
    try {
      const log: string[] = []
      let resolved = false
      const p = runCapped(signal => new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          // The push needs a moment to wind down after the abort.
          setTimeout(() => { log.push('push-stopped'); resolve() }, 500)
        })
      })).then(() => { resolved = true; log.push('caller-continues') })
      await vi.advanceTimersByTimeAsync(PUSH_BEFORE_WIPE_MS)
      expect(resolved).toBe(false)         // aborted, but the caller (the wipe) is still held back
      await vi.advanceTimersByTimeAsync(500)
      await p
      expect(log).toEqual(['push-stopped', 'caller-continues'])
    } finally { vi.useRealTimers() }
  })
  it('rejects, so the wipe is skipped, when the push does not stop within the grace', async () => {
    vi.useFakeTimers()
    try {
      const p = runCapped(() => new Promise<void>(() => { /* never settles */ }))
      const caught = p.then(() => null, (e: Error) => e)
      await vi.advanceTimersByTimeAsync(PUSH_BEFORE_WIPE_MS + PUSH_SETTLE_GRACE_MS)
      expect((await caught)?.message).toMatch(/did not stop/)
    } finally { vi.useRealTimers() }
  })
  it('a push that throws is best effort: it resolves', async () => {
    await expect(runCapped(async () => { throw new Error('network') })).resolves.toBeUndefined()
  })
})

describe('sessionPredatesFromAnswer: only a cookie session feeds the adopt decision', () => {
  it('null is a session from before the stamp, a number is a fresh sign-in', () => {
    expect(sessionPredatesFromAnswer({ epoch: 0, signedInAt: null })).toBe(true)
    expect(sessionPredatesFromAnswer({ epoch: 0, signedInAt: 1_790_000_000 })).toBe(false)
  })
  it('an answer with no signedInAt (a bearer session) cannot be told, so the store stays closed', () => {
    expect(() => sessionPredatesFromAnswer({ epoch: 0 })).toThrow()
    expect(() => sessionPredatesFromAnswer(null)).toThrow()
    expect(() => sessionPredatesFromAnswer({ epoch: 0, signedInAt: 'now' })).toThrow()
  })
})
