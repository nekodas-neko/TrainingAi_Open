import { describe, it, expect } from 'vitest'
import { buildCardExerciseSignals, computeRm1Trend } from '@trainingai/shared/ai-periodization/signals'

const ex = (id: string, name: string, role = 'primary') =>
  ({ id, exerciseName: name, exerciseRole: role })

describe('buildCardExerciseSignals', () => {
  // This is the derivation the prescription CARD renders and the full aggregateSignals reuses
  // verbatim, so the card and the engine can never disagree about a lift's strength trend.
  it('carries identity and role straight through', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Barbell Bench Press'), ex('se-2', 'Tricep Pushdown', 'accessory')],
      new Map(), new Map(),
    )
    expect(out.map(e => [e.sessionExerciseId, e.name, e.role])).toEqual([
      ['se-1', 'Barbell Bench Press', 'primary'],
      ['se-2', 'Tricep Pushdown', 'accessory'],
    ])
  })

  it('reports the trend and delta from the latest estimate vs the one before it', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Bench')],
      new Map([['Bench', 100]]),
      new Map([['Bench', { latest: 100, previous: 95 }]]),
    )
    expect(out[0].current1rm).toBe(100)
    expect(out[0].latest1rm).toBe(100)
    expect(out[0].rm1Trend).toBe('up')
    expect(out[0].rm1ChangeKg).toBe(5)
  })

  it('reports a regression as down with a negative delta', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Bench')],
      new Map([['Bench', 100]]),
      new Map([['Bench', { latest: 90, previous: 100 }]]),
    )
    expect(out[0].rm1Trend).toBe('down')
    expect(out[0].rm1ChangeKg).toBe(-10)
  })

  // #3891: the old rule compared the all-time best with the second-latest estimate, so the best
  // (never below a later estimate) decided the answer and nothing could read down.
  it('is not decided by an all-time best far above both recent estimates', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Bench')],
      new Map([['Bench', 140]]),
      new Map([['Bench', { latest: 100, previous: 104 }]]),
    )
    expect(out[0].current1rm).toBe(140) // still the display value
    expect(out[0].rm1Trend).toBe('down')
    expect(out[0].rm1ChangeKg).toBe(-4)
  })

  // A lift with no history must read as flat/0, never as a regression — the card renders
  // this directly, and "down" on an unlogged exercise would be a false negative signal.
  it('reads flat with no delta when there is no estimate at all', () => {
    const out = buildCardExerciseSignals([ex('se-1', 'Bench')], new Map(), new Map())
    expect(out[0].current1rm).toBeNull()
    expect(out[0].latest1rm).toBeNull()
    expect(out[0].rm1Trend).toBe('flat')
    expect(out[0].rm1ChangeKg).toBe(0)
  })

  it('reads flat with no delta on a first estimate (no previous to compare)', () => {
    const out = buildCardExerciseSignals([ex('se-1', 'Bench')], new Map([['Bench', 100]]), new Map([['Bench', { latest: 100 }]]))
    expect(out[0].current1rm).toBe(100)
    expect(out[0].rm1Trend).toBe('flat')
    expect(out[0].rm1ChangeKg).toBe(0)
  })

  it('keeps exercises in session order', () => {
    const out = buildCardExerciseSignals(
      [ex('a', 'A'), ex('b', 'B'), ex('c', 'C')], new Map(), new Map(),
    )
    expect(out.map(e => e.name)).toEqual(['A', 'B', 'C'])
  })
})

describe('computeRm1Trend (#3891)', () => {
  it('reads down when the latest is below the previous by more than the band', () => {
    expect(computeRm1Trend({ latest: 99, previous: 100 })).toEqual({ trend: 'down', changeKg: -1 })
  })
  it('reads up when the latest is above the previous by more than the band', () => {
    expect(computeRm1Trend({ latest: 101, previous: 100 })).toEqual({ trend: 'up', changeKg: 1 })
  })
  it('reads flat inside the 0.5 kg band', () => {
    expect(computeRm1Trend({ latest: 100.25, previous: 100 }).trend).toBe('flat')
    expect(computeRm1Trend({ latest: 99.75, previous: 100 }).trend).toBe('flat')
  })
  it('reads flat, change 0, with fewer than two estimates', () => {
    expect(computeRm1Trend(undefined)).toEqual({ trend: 'flat', changeKg: 0 })
    expect(computeRm1Trend({ latest: 100 })).toEqual({ trend: 'flat', changeKg: 0 })
  })
})
