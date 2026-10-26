// #3369 — a device behind an admin reset wipes before it can push the old rows back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkDataEpoch, verifyDataEpoch, handleStaleDataEpoch, _resetDataEpochGate, type DataEpochDeps } from '../data-epoch'

const U = 'user-1'

function deps(over: Partial<DataEpochDeps> & { server?: number | null; record?: string | null; flag?: string | null } = {}) {
  const state = { record: over.record ?? null, flag: over.flag ?? null, order: [] as string[] }
  const d: DataEpochDeps = {
    fetchEpoch: vi.fn(async () => (over.server === undefined ? 0 : over.server)),
    readRecord: () => state.record,
    writeRecord: vi.fn(v => { state.order.push('record'); state.record = v; return true }),
    readWipedFlag: () => state.flag,
    writeWipedFlag: vi.fn(v => { state.flag = v }),
    wipe: vi.fn(async () => { state.order.push('wipe'); state.record = null }),   // the wipe clears this key too
    reload: vi.fn(() => { state.order.push('reload') }),
    ...over,
  }
  return { d, state }
}

describe('checkDataEpoch', () => {
  it('lets a device through when the account was never reset, and records that', async () => {
    const { d } = deps({ server: 0 })
    expect(await checkDataEpoch(U, d)).toBe('ok')
    expect(d.writeRecord).toHaveBeenCalledWith(`${U}:0`)
    expect(d.wipe).not.toHaveBeenCalled()
  })

  it('lets a device through that has already seen this reset', async () => {
    const { d } = deps({ server: 1_800_000_000, record: `${U}:1800000000` })
    expect(await checkDataEpoch(U, d)).toBe('ok')
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
  })

  it('wipes a device that last saw an earlier epoch, records the new one after the wipe, then reloads', async () => {
    const { d, state } = deps({ server: 1_800_000_500, record: `${U}:0` })
    expect(await checkDataEpoch(U, d)).toBe('wiped')
    expect(state.order).toEqual(['wipe', 'record', 'reload'])
    expect(state.record).toBe(`${U}:1800000500`)
  })

  it('wipes a device with no record when the server has a reset, which is the stale phone signing in again', async () => {
    const { d } = deps({ server: 1_800_000_500, record: null })
    expect(await checkDataEpoch(U, d)).toBe('wiped')
    expect(d.wipe).toHaveBeenCalledTimes(1)
  })

  it('treats another user\'s record as no record', async () => {
    const { d } = deps({ server: 1_800_000_500, record: 'someone-else:1800000500' })
    expect(await checkDataEpoch(U, d)).toBe('wiped')
  })

  it('fails closed: a server that cannot be reached is not an ok, and nothing is wiped', async () => {
    const { d } = deps({ server: null })
    expect(await checkDataEpoch(U, d)).toBe('unknown')
    expect(d.wipe).not.toHaveBeenCalled()
    expect(d.writeRecord).not.toHaveBeenCalled()
  })

  it('does not loop when the record cannot be kept: one wipe per tab session, no reload', async () => {
    const { d, state } = deps({ server: 1_800_000_500, record: null, writeRecord: vi.fn(() => false) })
    expect(await checkDataEpoch(U, d)).toBe('wiped')
    expect(d.reload).not.toHaveBeenCalled()
    expect(await checkDataEpoch(U, d)).toBe('ok')
    expect(d.wipe).toHaveBeenCalledTimes(1)
    expect(state.flag).toBe(`${U}:1800000500`)
  })

  it('wipes again for a LATER reset in the same tab session', async () => {
    const { d } = deps({ server: 1_800_000_900, record: `${U}:1800000500`, flag: `${U}:1800000500` })
    expect(await checkDataEpoch(U, d)).toBe('wiped')
  })

  it('does not wipe for a record newer than the server (a clock or restore oddity), and never goes backwards', async () => {
    const { d } = deps({ server: 100, record: `${U}:200` })
    expect(await checkDataEpoch(U, d)).toBe('ok')
    expect(d.wipe).not.toHaveBeenCalled()
  })
})

describe('verifyDataEpoch', () => {
  beforeEach(() => _resetDataEpochGate())

  it('remembers an ok for the page and shares one request between concurrent callers', async () => {
    const { d } = deps({ server: 0 })
    const [a, b] = await Promise.all([verifyDataEpoch(U, d), verifyDataEpoch(U, d)])
    expect([a, b]).toEqual(['ok', 'ok'])
    await verifyDataEpoch(U, d)
    expect(d.fetchEpoch).toHaveBeenCalledTimes(1)
  })

  it('asks again after anything but an ok', async () => {
    const fetchEpoch = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(0)
    const { d } = deps({ fetchEpoch })
    expect(await verifyDataEpoch(U, d)).toBe('unknown')
    expect(await verifyDataEpoch(U, d)).toBe('ok')
    expect(fetchEpoch).toHaveBeenCalledTimes(2)
  })

  it('answers unknown, not a throw, when the wipe itself fails', async () => {
    const { d } = deps({ server: 1_800_000_500, wipe: vi.fn(async () => { throw new Error('disk') }) })
    expect(await verifyDataEpoch(U, d)).toBe('unknown')
  })

  it('passes straight through where there is no native store (the web build and tests)', async () => {
    expect(await verifyDataEpoch(U)).toBe('ok')
  })
})

describe('the cookie the server\'s write gate reads (#3369)', () => {
  it('is cleared before the wipe and set to the new epoch after it', async () => {
    const calls: Array<string | null> = []
    const { d } = deps({ server: 1_800_000_500, record: `${U}:0`, mirror: (v: string | null) => { calls.push(v) } })
    await checkDataEpoch(U, d)
    expect(calls).toEqual([null, `${U}:1800000500`])
  })
  it('is kept in step for a device that has already seen the reset', async () => {
    const calls: Array<string | null> = []
    const { d } = deps({ server: 1_800_000_500, record: `${U}:1800000500`, mirror: (v: string | null) => { calls.push(v) } })
    await checkDataEpoch(U, d)
    expect(calls).toEqual([`${U}:1800000500`])
  })
})

describe('handleStaleDataEpoch: a write answered 409', () => {
  it('asks the server again past the memo and wipes a device that is behind', async () => {
    _resetDataEpochGate()
    const { d } = deps({ server: 1_800_000_500, record: `${U}:1800000500` })
    // The memo says this page already verified; the 409 proves the record is not what the server needs.
    await verifyDataEpoch(U, d)
    ;(d.fetchEpoch as ReturnType<typeof vi.fn>).mockResolvedValue(1_800_000_900)
    expect(await handleStaleDataEpoch(U, d)).toBe('wiped')
    expect(d.wipe).toHaveBeenCalledTimes(1)
  })
  it('does nothing for an unknown user', async () => {
    const { d } = deps({ server: 5 })
    expect(await handleStaleDataEpoch(null, d)).toBe('unknown')
    expect(d.fetchEpoch).not.toHaveBeenCalled()
  })
})
