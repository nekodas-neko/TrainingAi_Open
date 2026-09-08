import { describe, it, expect } from 'vitest'
import { scoreGapText } from '../score-gap-copy'
import { metricAvailability } from '@/lib/health/score-availability'
import type { MetricAvailability } from '@/lib/health/score-availability'

const absent = (metric: string, gap: 'no_input' | 'awaiting_baseline'): MetricAvailability =>
  ({ metric, state: 'absent', gap, degradedInputs: [] })

describe('scoreGapText', () => {
  it('tells the two reasons apart, because only one of them is fixed by waiting', () => {
    expect(scoreGapText([absent('readiness', 'no_input')], 'readiness'))
      .toBe('Nothing recorded for today')
    expect(scoreGapText([absent('readiness', 'awaiting_baseline')], 'readiness'))
      .toBe('Not enough history to score this yet')
  })

  it('says nothing for a score that is present', () => {
    const present = metricAvailability('sleep', 82)
    expect(present.state).toBe('present')
    expect(scoreGapText([present], 'sleep')).toBeNull()
  })

  // The field is optional on the response type on purpose: a client seeds this payload
  // synchronously from SQLite and can hold a response written before the field existed. Absent must
  // read as "unknown", never as "nothing is missing".
  it('says nothing when the payload predates the field, or omits this metric', () => {
    expect(scoreGapText(undefined, 'readiness')).toBeNull()
    expect(scoreGapText([], 'readiness')).toBeNull()
    expect(scoreGapText([absent('sleep', 'no_input')], 'activity')).toBeNull()
  })

  it('reads the metric it was asked for, not the first absent one', () => {
    const list = [absent('readiness', 'no_input'), absent('activity', 'awaiting_baseline')]
    expect(scoreGapText(list, 'activity')).toBe('Not enough history to score this yet')
  })

  // Driven through the real producer rather than a hand-built literal — the gap between "the copy
  // helper works" and "the helper is fed what the route actually emits" is where Q-278's engine half
  // recorded its own near-miss.
  it('is driven by what metricAvailability actually produces', () => {
    const noInput = metricAvailability('readiness', null)
    expect(scoreGapText([noInput], 'readiness')).toBe('Nothing recorded for today')

    const cold = metricAvailability('readiness', null, {
      hrv: { gap: 'awaiting_baseline' }, restingHeartRate: { gap: 'awaiting_baseline' },
    })
    expect(scoreGapText([cold], 'readiness')).toBe('Not enough history to score this yet')

    // A mixed set resolves to `no_input` in the producer — waiting cannot fix the half that has no
    // data — so the surface must not offer the optimistic sentence.
    const mixed = metricAvailability('readiness', null, {
      hrv: { gap: 'awaiting_baseline' }, sleep: { gap: 'no_input' },
    })
    expect(scoreGapText([mixed], 'readiness')).toBe('Nothing recorded for today')
  })
})
