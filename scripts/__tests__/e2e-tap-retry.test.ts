// issue 2980 — the shared hit-test used to probe once. It retries inside a budget and taps once.
// `e2e/tap-retry.ts` has no Playwright import so the retry logic is testable here; the e2e specs
// that use it run in CI.
import { describe, expect, it } from 'vitest'
import { tapOnceItLands, TAP_LANDS_WITHIN_MS, type HitAttempt } from '../../e2e/tap-retry'

const miss = (tag = 'BUTTON.neighbour'): HitAttempt => ({ x: 206, y: 511, hit: { inside: false, tag } })
const land = (): HitAttempt => ({ x: 206, y: 540, hit: { inside: true, tag: 'BUTTON.target' } })

function harness(attempts: HitAttempt[], opts: { budgetMs?: number; stepMs?: number } = {}) {
  let clock = 0
  const taps: Array<[number, number]> = []
  let calls = 0
  let pauses = 0
  const run = () => tapOnceItLands({
    attempt: async () => { calls++; return attempts[Math.min(calls - 1, attempts.length - 1)] },
    tap: async (x, y) => { taps.push([x, y]) },
    pause: async () => { pauses++; clock += opts.stepMs ?? 100 },
    now: () => clock,
    budgetMs: opts.budgetMs,
  })
  return { run, taps, calls: () => calls, pauses: () => pauses }
}

describe('tapOnceItLands', () => {
  it('taps at once, and once, when the first probe lands', async () => {
    const h = harness([land()])
    await h.run()
    expect(h.taps).toEqual([[206, 540]])
    expect(h.calls()).toBe(1)
    expect(h.pauses()).toBe(0)
  })

  it('waits out a neighbour that is only passing through, then taps where it landed', async () => {
    // The 2980 shape: a layout still settling puts another button at the coordinate for a moment.
    const h = harness([miss(), miss(), land()])
    await h.run()
    expect(h.calls()).toBe(3)
    expect(h.pauses()).toBe(2)
    // the tap goes where the LANDING probe was taken, not where the first probe was
    expect(h.taps).toEqual([[206, 540]])
  })

  it('still fails, naming what it hit, when the tap never lands — a real occlusion is not hidden', async () => {
    const h = harness([miss('DIV.overlay')], { budgetMs: 1_000, stepMs: 100 })
    await expect(h.run()).rejects.toThrow(/would land on DIV\.overlay, not the target \(still the case after 1 s\)/)
    expect(h.taps).toEqual([])
    // it tried for the budget (about ten pauses of 100 ms), not once
    expect(h.calls()).toBeGreaterThan(5)
  })

  it('reports the position of the LAST attempt in its error', async () => {
    const h = harness([{ x: 10, y: 20, hit: { inside: false, tag: 'A' } }, { x: 30, y: 40, hit: { inside: false, tag: 'B' } }], { budgetMs: 100, stepMs: 100 })
    await expect(h.run()).rejects.toThrow(/at \(30, 40\) would land on B/)
  })

  it('has a budget long enough to cover a page finishing its first paint, and short enough to fail fast', () => {
    expect(TAP_LANDS_WITHIN_MS).toBeGreaterThanOrEqual(3_000)
    expect(TAP_LANDS_WITHIN_MS).toBeLessThanOrEqual(10_000)
  })
})
