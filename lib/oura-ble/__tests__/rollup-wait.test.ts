/**
 * Q-91-followup — `waitForRollup`, the thing that stops a drain-end signal from firing before the
 * server has derived anything.
 *
 * The bug it exists to fix is a timing one that no amount of reading the client reveals: the
 * native `ingestStored` counter advances when the server has STORED rows, and that is the same
 * moment the server schedules its rollup on a 3 s trailing-edge debounce. The old listener waited
 * 1500 ms — always less — so it invalidated before the rollup had started and the refetch it
 * triggered cached a pre-rollup read.
 *
 * Everything external is injected, because `getOuraBle()` returns null in the sandbox and a helper
 * that reached for the plugin, `fetch` or `window` could not be exercised here at all.
 */
import { describe, it, expect, vi } from 'vitest'
import { waitForRollup, type RollupState } from '@/lib/oura-ble/rollup-wait'

const DELAYS = [10, 10, 10] as const

/** Reads the given states in order; the last one repeats once exhausted. */
const reader = (states: (RollupState | null)[]) => {
  let i = 0
  return vi.fn(async () => states[Math.min(i++, states.length - 1)])
}

describe('waitForRollup (Q-91-followup)', () => {
  it('resolves `advanced` once the watermark moves past the baseline', async () => {
    const sleep = vi.fn(async () => {})
    const read = reader([{ lastRolledDs: 500, epoch: 1 }, { lastRolledDs: 900, epoch: 1 }])

    const outcome = await waitForRollup({
      read, sleep, baseline: { lastRolledDs: 500, epoch: 1 }, delaysMs: DELAYS,
    })

    expect(outcome).toBe('advanced')
    expect(read).toHaveBeenCalledTimes(2)
  })

  // The whole point: the rollup has not run yet when the caller starts waiting, so reading
  // immediately would see the baseline and a naive implementation could call that a verdict.
  it('sleeps before its first read, never reads immediately', async () => {
    const order: string[] = []
    const sleep = vi.fn(async () => { order.push('sleep') })
    const read = vi.fn(async () => { order.push('read'); return { lastRolledDs: 900, epoch: 1 } })

    await waitForRollup({ read, sleep, baseline: { lastRolledDs: 500, epoch: 1 }, delaysMs: DELAYS })

    expect(order[0]).toBe('sleep')
  })

  it('does not treat an unchanged watermark as progress, and stops at the schedule', async () => {
    const sleep = vi.fn(async () => {})
    const read = reader([{ lastRolledDs: 500, epoch: 1 }])

    const outcome = await waitForRollup({
      read, sleep, baseline: { lastRolledDs: 500, epoch: 1 }, delaysMs: DELAYS,
    })

    // A drain carrying nothing the rollup changes never moves it. Timing out is the correct,
    // ordinary end — and it must not poll past its schedule.
    expect(outcome).toBe('timeout')
    expect(read).toHaveBeenCalledTimes(DELAYS.length)
    expect(sleep).toHaveBeenCalledTimes(DELAYS.length)
  })

  // The ring's deciseconds counter restarts from zero on a re-key, so a SMALLER number under a new
  // epoch is progress. Comparing across that boundary is meaningless, which is why the epoch is
  // checked before the counter.
  it('reports a re-key even though the counter went backwards', async () => {
    const sleep = vi.fn(async () => {})
    const read = reader([{ lastRolledDs: 12, epoch: 2 }])

    const outcome = await waitForRollup({
      read, sleep, baseline: { lastRolledDs: 90_000, epoch: 1 }, delaysMs: DELAYS,
    })

    expect(outcome).toBe('re-keyed')
  })

  it('counts any watermark as progress when there is no baseline to beat', async () => {
    const sleep = vi.fn(async () => {})
    const read = reader([{ lastRolledDs: 5, epoch: 1 }])

    // Null baseline = no rollup had ever succeeded, or the pre-read failed. Requiring "greater than
    // nothing" would hang the wait out to its ceiling on the very first sync after a fresh install.
    expect(await waitForRollup({ read, sleep, baseline: null, delaysMs: DELAYS })).toBe('advanced')
  })

  it('keeps waiting through a failed read rather than calling it a verdict', async () => {
    const sleep = vi.fn(async () => {})
    const read = reader([null, null, { lastRolledDs: 900, epoch: 1 }])

    const outcome = await waitForRollup({
      read, sleep, baseline: { lastRolledDs: 500, epoch: 1 }, delaysMs: DELAYS,
    })

    expect(outcome).toBe('advanced')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('follows the schedule it is given, in order', async () => {
    const slept: number[] = []
    const sleep = vi.fn(async (ms: number) => { slept.push(ms) })
    const read = reader([{ lastRolledDs: 500, epoch: 1 }])

    await waitForRollup({
      read, sleep, baseline: { lastRolledDs: 500, epoch: 1 }, delaysMs: [3_000, 5_000, 10_000],
    })

    expect(slept).toEqual([3_000, 5_000, 10_000])
  })
})
