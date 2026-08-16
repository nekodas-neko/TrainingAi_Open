import { describe, it, expect } from 'vitest'
import { buildCardExerciseSignals } from '@trainingai/shared/ai-periodization/signals'

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

  it('reports the trend and delta from current vs previous PR', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Bench')],
      new Map([['Bench', 100]]),
      new Map([['Bench', 95]]),
    )
    expect(out[0].current1rm).toBe(100)
    expect(out[0].rm1Trend).toBe('up')
    expect(out[0].rm1ChangeKg).toBe(5)
  })

  it('reports a regression as down with a negative delta', () => {
    const out = buildCardExerciseSignals(
      [ex('se-1', 'Bench')],
      new Map([['Bench', 90]]),
      new Map([['Bench', 100]]),
    )
    expect(out[0].rm1Trend).toBe('down')
    expect(out[0].rm1ChangeKg).toBe(-10)
  })

  // A lift with no PR history must read as flat/0, never as a regression — the card renders
  // this directly, and "down" on an unlogged exercise would be a false negative signal.
  it('reads flat with no delta when there is no PR at all', () => {
    const out = buildCardExerciseSignals([ex('se-1', 'Bench')], new Map(), new Map())
    expect(out[0].current1rm).toBeNull()
    expect(out[0].rm1Trend).toBe('flat')
    expect(out[0].rm1ChangeKg).toBe(0)
  })

  it('reads flat with no delta on a first-ever PR (no previous to compare)', () => {
    const out = buildCardExerciseSignals([ex('se-1', 'Bench')], new Map([['Bench', 100]]), new Map())
    expect(out[0].current1rm).toBe(100)
    expect(out[0].rm1ChangeKg).toBe(0)
  })

  it('keeps exercises in session order', () => {
    const out = buildCardExerciseSignals(
      [ex('a', 'A'), ex('b', 'B'), ex('c', 'C')], new Map(), new Map(),
    )
    expect(out.map(e => e.name)).toEqual(['A', 'B', 'C'])
  })
})
