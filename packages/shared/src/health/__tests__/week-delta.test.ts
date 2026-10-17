import { describe, it, expect } from 'vitest'
import { weekDelta } from '../week-delta'

// The web WeekMetricCard's own logic as it stood before it called weekDelta, kept here as the
// reference the shared function must keep matching string for string.
function legacyWeb(week: number | null, priorWeek: number | null, unit: string, decimals: number, higherIsBetter: boolean) {
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(decimals))
  const delta = week != null && priorWeek != null ? week - priorWeek : null
  const rose = delta != null && delta > 0
  const flat = delta != null && Math.abs(delta) < Number.EPSILON
  const good = delta == null || flat ? null : rose === higherIsBetter
  const text =
    delta == null
      ? priorWeek == null ? 'No week before this one' : 'Not measured this week'
      : `${flat ? 'Level with' : `${rose ? '↑' : '↓'} ${Math.abs(delta).toFixed(decimals)}${unit} on`} ${fmt(priorWeek)}`
  return { text, cue: delta == null ? null : flat ? 'same' : good ? 'good' : 'bad' }
}

describe('weekDelta', () => {
  it('prints the web strings', () => {
    expect(weekDelta(7, 5, { unit: 'h', decimals: 1 })).toEqual({ text: '↑ 2.0h on 5.0', cue: 'good' })
    expect(weekDelta(40, 30, { unit: 'm', higherIsBetter: false })).toEqual({ text: '↑ 10m on 30', cue: 'bad' })
    expect(weekDelta(20, 30, { unit: 'm', higherIsBetter: false })).toEqual({ text: '↓ 10m on 30', cue: 'good' })
    expect(weekDelta(60, 60)).toEqual({ text: 'Level with 60', cue: 'same' })
    expect(weekDelta(60, null)).toEqual({ text: 'No week before this one', cue: null })
    expect(weekDelta(null, 60)).toEqual({ text: 'Not measured this week', cue: null })
    expect(weekDelta(null, null).text).toBe('No week before this one')
  })

  it('is flat only at an exact zero, so a small change keeps its arrow', () => {
    expect(weekDelta(60.2, 60)).toEqual({ text: '↑ 0 on 60', cue: 'good' })
  })

  it('matches the previous web card across a grid of inputs', () => {
    const values = [null, 0, 5, 5.04, 6.5, 60, 61.3, 72]
    for (const week of values) for (const prior of values) for (const decimals of [0, 1])
      for (const unit of ['', 'h', 'ms', 'm']) for (const higherIsBetter of [true, false]) {
        expect(weekDelta(week, prior, { unit, decimals, higherIsBetter })).toEqual(
          legacyWeb(week, prior, unit, decimals, higherIsBetter),
        )
      }
  })
})
