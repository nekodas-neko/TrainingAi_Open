// #3369 (c) — a different account signing in on a device wipes it before anything local is read or synced.
import { describe, it, expect, vi } from 'vitest'
import { checkStoreOwner, resolveStoreOwnerMismatch, resolveUnclaimedStore, _resetStoreOwnerGate, type OwnerDeps } from '../device-owner'

function deps(initial: string | null, over: Partial<OwnerDeps> = {}) {
  const state = { owner: initial, flag: null as string | null, order: [] as string[] }
  const d: OwnerDeps = {
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
    const { d } = deps('old', { wipe: vi.fn(async () => { throw new Error('locked') }) })
    await resolveStoreOwnerMismatch('new', d)
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
    await resolveUnclaimedStore('new', d)
    expect(d.hasData).toHaveBeenCalledTimes(2)
  })
  it('a failed wipe claims nothing and the next call tries again', async () => {
    _resetStoreOwnerGate()
    const { d, state } = deps(null, { wipe: vi.fn(async () => { throw new Error('locked') }) })
    await resolveUnclaimedStore('new', d)
    await resolveUnclaimedStore('new', d)
    expect(d.wipe).toHaveBeenCalledTimes(2)
    expect(state.owner).toBeNull()
    expect(d.reload).not.toHaveBeenCalled()
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
