import { describe, it, expect } from 'vitest'
import { hypnogramSegments, stageTotals, sleepCycles, phasesToPhase5Min, intervalsToPhase5Min } from '@trainingai/shared/health/hypnogram'

const rep = (stage: string, n: number) => Array(n).fill(stage)

describe('phasesToPhase5Min', () => {
  it('downsamples 30-second codes into 5-min majority chars', () => {
    // 10 deep (5 min) then 10 light (5 min) → '12'
    expect(phasesToPhase5Min([...rep('deep', 10), ...rep('light', 10)])).toBe('12')
  })
  it('takes the majority stage within a 5-min bucket', () => {
    // 6 light + 4 deep in one bucket → light wins
    expect(phasesToPhase5Min([...rep('light', 6), ...rep('deep', 4)])).toBe('2')
  })
  it('breaks an even split toward the deeper stage (deep > rem > light > awake)', () => {
    expect(phasesToPhase5Min([...rep('deep', 5), ...rep('light', 5)])).toBe('1')
    expect(phasesToPhase5Min([...rep('rem', 5), ...rep('light', 5)])).toBe('3')
  })
  it('emits a char for a partial trailing bucket', () => {
    // 10 deep + 5 deep → two buckets → '11'
    expect(phasesToPhase5Min(rep('deep', 15))).toBe('11')
  })
  it('ignores unknown codes and skips an all-unknown bucket', () => {
    expect(phasesToPhase5Min([...rep('x', 3), ...rep('rem', 7)])).toBe('3')
    expect(phasesToPhase5Min(rep('x', 10))).toBe('')
  })
  it('returns empty for empty input', () => {
    expect(phasesToPhase5Min([])).toBe('')
  })
})

describe('hypnogramSegments', () => {
  it('merges consecutive identical stages into timed segments', () => {
    // '4411' = 10 min awake then 10 min deep
    expect(hypnogramSegments('4411')).toEqual([
      { stage: 'awake', startMin: 0, durationMin: 10 },
      { stage: 'deep', startMin: 10, durationMin: 10 },
    ])
  })
  it('handles stage changes every interval and skips unknown codes', () => {
    expect(hypnogramSegments('123x2')).toEqual([
      { stage: 'deep', startMin: 0, durationMin: 5 },
      { stage: 'light', startMin: 5, durationMin: 5 },
      { stage: 'rem', startMin: 10, durationMin: 5 },
      // 'x' skipped but time still advances
      { stage: 'light', startMin: 20, durationMin: 5 },
    ])
  })
  it('returns empty for empty/null-ish input', () => {
    expect(hypnogramSegments('')).toEqual([])
  })
})

describe('stageTotals', () => {
  it('sums minutes per stage', () => {
    // '4411' = 10 min awake then 10 min deep
    expect(stageTotals(hypnogramSegments('4411'))).toEqual({ awake: 10, deep: 10, light: 0, rem: 0 })
  })
  it('returns all zeros for no segments', () => {
    expect(stageTotals([])).toEqual({ awake: 0, deep: 0, light: 0, rem: 0 })
  })
})

describe('sleepCycles', () => {
  it('counts one cycle when there is no REM->deep/light descent', () => {
    // deep, light, rem (no descent after rem)
    expect(sleepCycles(hypnogramSegments('123'))).toEqual({ count: 1, boundaries: [] })
  })
  it('detects a cycle boundary at each REM -> deep/light descent', () => {
    // segments: deep(0-5) light(5-10) rem(10-20) light(20-25) deep(25-35) rem(35-40) light(40-45) deep(45-50)
    // boundaries at the two REM->light descents (minute 20 and minute 40)
    const segments = hypnogramSegments('1233211321')
    const cycles = sleepCycles(segments)
    expect(cycles.boundaries).toEqual([20, 40])
    expect(cycles.count).toBe(3)
  })
  it('returns zero cycles for no segments', () => {
    expect(sleepCycles([])).toEqual({ count: 0, boundaries: [] })
  })
})

describe('intervalsToPhase5Min', () => {
  const T = (min: number) => Date.parse('2026-07-20T22:00:00.000Z') + min * 60_000
  const iv = (fromMin: number, toMin: number, stage: 'deep' | 'light' | 'rem' | 'awake' | null) =>
    ({ startMs: T(fromMin), endMs: T(toMin), stage })

  it('rasterises a realistic staged night, awake block included', () => {
    // 40 min: light 0-10, deep 10-20, awake 20-25, rem 25-35, light 35-40
    const out = intervalsToPhase5Min(
      [iv(0, 10, 'light'), iv(10, 20, 'deep'), iv(20, 25, 'awake'), iv(25, 35, 'rem'), iv(35, 40, 'light')],
      T(0), T(40),
    )
    expect(out).toBe('22114332')
  })

  it('takes the stage with the most of a bucket when one splits', () => {
    // Bucket 0: 3 min deep, 2 min light → deep.
    expect(intervalsToPhase5Min([iv(0, 3, 'deep'), iv(3, 5, 'light')], T(0), T(5))).toBe('1')
  })

  it('returns null when the provider staged only part of the night', () => {
    expect(intervalsToPhase5Min([iv(0, 10, 'light')], T(0), T(20))).toBeNull()
  })

  it('returns null when every span is unstaged (generic sleep only)', () => {
    expect(intervalsToPhase5Min([iv(0, 20, null)], T(0), T(20))).toBeNull()
  })

  it('ignores an unstaged span that a staged one already covers', () => {
    expect(intervalsToPhase5Min([iv(0, 10, null), iv(0, 10, 'rem')], T(0), T(10))).toBe('33')
  })

  it('returns null for no intervals or a non-positive span', () => {
    expect(intervalsToPhase5Min([], T(0), T(30))).toBeNull()
    expect(intervalsToPhase5Min([iv(0, 10, 'deep')], T(10), T(10))).toBeNull()
  })

  it('covers a final partial bucket rather than dropping it', () => {
    // 7 minutes = one full bucket + a 2-min tail; both are covered, so both are emitted.
    expect(intervalsToPhase5Min([iv(0, 7, 'deep')], T(0), T(7))).toBe('11')
  })
})
