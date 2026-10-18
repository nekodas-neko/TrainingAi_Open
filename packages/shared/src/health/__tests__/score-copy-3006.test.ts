import { describe, it, expect } from 'vitest'
import { scoreGapText, PROVISIONAL_BASELINE_NOTE } from '../score-gap-copy'
import { scoreAverageChip } from '../score-average-chip'

describe('scoreGapText', () => {
  it('words each absent reason and stays silent otherwise', () => {
    const entry = (state: string, gap: unknown) => [{ metric: 'readiness', state, gap }]
    expect(scoreGapText(entry('absent', 'no_input'), 'readiness')).toBe('Nothing recorded for today')
    expect(scoreGapText(entry('absent', 'awaiting_baseline'), 'readiness')).toBe('Not enough history to score this yet')
    expect(scoreGapText(entry('absent', null), 'readiness')).toBeNull()
    expect(scoreGapText(entry('absent', 'something_new'), 'readiness')).toBeNull()
    expect(scoreGapText(entry('present', null), 'readiness')).toBeNull()
    expect(scoreGapText(undefined, 'readiness')).toBeNull()
  })
  it('keeps the sentence about scoring against your own normal', () => {
    expect(PROVISIONAL_BASELINE_NOTE).toMatch(/then it scores against your own normal\.$/)
  })
})

describe('scoreAverageChip', () => {
  it('prints the sign, the gap and the average of the prior days', () => {
    expect(scoreAverageChip(80, [70, null, 72])?.text).toBe('+9 vs your 2-day average (71)')
    expect(scoreAverageChip(60, [70, 72])?.text).toBe('−11 vs your 2-day average (71)')
    expect(scoreAverageChip(71, [70, 72])?.text).toBe('±0 vs your 2-day average (71)')
  })
  it('needs a score today and at least one scored prior day', () => {
    expect(scoreAverageChip(null, [70])).toBeNull()
    expect(scoreAverageChip(70, [null])).toBeNull()
    expect(scoreAverageChip(70, [])).toBeNull()
  })
})
