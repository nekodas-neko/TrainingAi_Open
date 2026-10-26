// #3369 (c) — a different account signing in on a device wipes it before anything local is read or synced.
import { describe, it, expect, vi } from 'vitest'
import { checkStoreOwner, resolveStoreOwnerMismatch, _resetStoreOwnerGate, type OwnerDeps } from '../device-owner'

function deps(initial: string | null, over: Partial<OwnerDeps> = {}) {
  const state = { owner: initial, flag: null as string | null, order: [] as string[] }
  const d: OwnerDeps = {
    read: () => state.owner,
    write: vi.fn(u => { state.order.push('write'); state.owner = u; return true }),
    readWiped: () => state.flag,
    writeWiped: vi.fn(u => { state.flag = u }),
    wipe: vi.fn(async () => { state.order.push('wipe'); state.owner = null }),   // the wipe clears the record too
    reload: vi.fn(() => { state.order.push('reload') }),
    ...over,
  }
  return { d, state }
}

describe('checkStoreOwner', () => {
  it('adopts a device with no record', () => {
    const { d, state } = deps(null)
    expect(checkStoreOwner('new', d)).toBe('adopted')
    expect(state.owner).toBe('new')
  })
  it('recognises its own owner', () => {
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
