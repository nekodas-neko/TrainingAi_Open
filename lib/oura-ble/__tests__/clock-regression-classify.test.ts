import { describe, it, expect } from 'vitest'
import {
  classifyClockRegression, isCounterRestart, isClockEpochReset,
  EPOCH_REGRESSION_TOLERANCE_DS, EPOCH_RESTART_RATIO,
} from '@/lib/oura-ble/clock'

// Q-314. `isClockEpochReset` alone opened a new clock epoch on any ds regression over an hour, and a
// history re-drain produces exactly that shape — so a re-pair read as a ring-clock reset. The
// spurious epoch became `currentEpoch`, its offset was estimated from a burst where >90% of anchors
// carried re-drain backlog, and the rollup resolves every ds against `currentEpoch`. One re-pair
// therefore re-timed the owner's entire sleep history. Twice.
//
// The fixtures below are the two REAL events, not invented numbers.

/** 2026-07-30 — epoch 1 opened by a re-drain. Landed +12.17 h out. */
const REDRAIN_JULY = { batchMaxDs: 17_400_000, epochMaxDs: 33_000_000 }
/** 2026-08-17 — epoch 3 opened by a re-drain. Landed +14.16 h out, and did not self-heal. */
const REDRAIN_AUGUST = { batchMaxDs: 33_000_000, epochMaxDs: 37_112_321 }

describe('the two real re-drains must not open an epoch', () => {
  for (const [name, ev] of Object.entries({ 'july (+12.17h)': REDRAIN_JULY, 'august (+14.16h)': REDRAIN_AUGUST })) {
    it(`${name}: regresses, but is classified as a re-drain`, () => {
      // Both DO regress — which is precisely why the old check fired on them.
      expect(isClockEpochReset(ev.batchMaxDs, ev.epochMaxDs)).toBe(true)
      expect(isCounterRestart(ev.batchMaxDs, ev.epochMaxDs)).toBe(false)
      expect(classifyClockRegression(ev.batchMaxDs, ev.epochMaxDs, false))
        .toEqual({ action: 'extend', reason: 'redrain' })
    })
  }

  it('keeps a wide margin on both — neither is near the restart bound', () => {
    // 53% and 89% of the ceiling against a 5% bound: a factor of ten and more.
    const ratios = [REDRAIN_JULY, REDRAIN_AUGUST].map(e => e.batchMaxDs / e.epochMaxDs)
    expect(Math.min(...ratios)).toBeGreaterThan(EPOCH_RESTART_RATIO * 10)
  })
})

describe('a declaration opens the epoch', () => {
  it('wins even on a batch that looks perfectly ordinary', () => {
    expect(classifyClockRegression(37_500_000, 37_112_321, true))
      .toEqual({ action: 'open-epoch', reason: 'declared' })
  })

  // The case that matters and is easy to get wrong: a ring re-keyed mid-buffer can come back with a
  // HIGHER ds than the old ceiling. Requiring a regression before honouring the declaration would
  // silently ignore the owner saying the ring was re-keyed.
  it('does not require the counter to have regressed at all', () => {
    expect(isClockEpochReset(99_000_000, 37_112_321)).toBe(false)
    expect(classifyClockRegression(99_000_000, 37_112_321, true).action).toBe('open-epoch')
  })

  it('wins over a re-drain shape', () => {
    expect(classifyClockRegression(REDRAIN_AUGUST.batchMaxDs, REDRAIN_AUGUST.epochMaxDs, true))
      .toEqual({ action: 'open-epoch', reason: 'declared' })
  })
})

// Missing a real re-key is worse and quieter than the failure this replaces, so the counter shape
// still opens an epoch on its own when it genuinely restarted.
describe('an undeclared restart is still caught', () => {
  it('opens an epoch when the counter came back near zero', () => {
    expect(classifyClockRegression(1_200, 37_112_321, false))
      .toEqual({ action: 'open-epoch', reason: 'undeclared-restart' })
  })

  it('fires anywhere below the ratio and not above it', () => {
    const ceiling = 40_000_000
    const bound = ceiling * EPOCH_RESTART_RATIO
    expect(classifyClockRegression(bound - 1, ceiling, false).action).toBe('open-epoch')
    expect(classifyClockRegression(bound + 1, ceiling, false).action).toBe('extend')
  })

  it('scales with the ceiling rather than being a fixed floor', () => {
    // A ring re-keyed after two years: 5% of a ~630 M ceiling still leaves ~36 days of headroom.
    const twoYears = 630_000_000
    expect(isCounterRestart(30_000_000, twoYears)).toBe(true)
    // The same absolute ds against a young ring is ordinary in-sequence traffic.
    expect(isCounterRestart(30_000_000, 33_000_000)).toBe(false)
  })
})

describe('ordinary traffic is untouched', () => {
  it('extends on a batch above the high-water mark', () => {
    expect(classifyClockRegression(37_200_000, 37_112_321, false))
      .toEqual({ action: 'extend', reason: 'in-sequence' })
  })

  it('tolerates small out-of-order regressions as before', () => {
    const ceiling = 37_112_321
    expect(classifyClockRegression(ceiling - EPOCH_REGRESSION_TOLERANCE_DS + 1, ceiling, false))
      .toEqual({ action: 'extend', reason: 'in-sequence' })
  })

  // The very first batch has no ceiling to compare against. -Infinity must not be read as a restart.
  it('does not see a restart when there is no epoch history', () => {
    expect(isCounterRestart(5_000, -Infinity)).toBe(false)
    expect(isCounterRestart(5_000, 0)).toBe(false)
    expect(classifyClockRegression(5_000, -Infinity, false).action).toBe('extend')
  })
})
