import { describe, it, expect } from 'vitest'
import { scoreGapText, contributorNote, isLearningContributor, PROVISIONAL_BASELINE_NOTE, SCORE_GAP_TEXT } from '../score-gap-copy'
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

describe('contributorNote (#3016)', () => {
  it('keeps the baseline note only for a contributor really learning its baseline', () => {
    expect(contributorNote({ provisional: true, gap: 'awaiting_baseline' })).toBe(PROVISIONAL_BASELINE_NOTE)
  })
  it('uses the gap text when nothing was recorded', () => {
    expect(contributorNote({ provisional: true, gap: 'no_input' })).toBe(SCORE_GAP_TEXT.no_input)
  })
  it("explains Oura's own recovery reading", () => {
    const note = contributorNote({ provisional: true, gap: null, scale: 'oura_contributor' })
    expect(note).toMatch(/^From your ring's own recovery reading/)
  })
  it('explains the overnight-HR estimate', () => {
    const note = contributorNote({ provisional: true, gap: null })
    expect(note).toMatch(/^Estimated from your overnight heart rate/)
  })
  it('stays silent for a scored contributor and falls back for a payload without gap', () => {
    expect(contributorNote({ provisional: false, gap: null })).toBeNull()
    expect(contributorNote({ provisional: true })).toBe(PROVISIONAL_BASELINE_NOTE)
  })
})

describe('isLearningContributor (#3029)', () => {
  it('is true while learning the baseline or with nothing recorded', () => {
    expect(isLearningContributor({ provisional: true, gap: 'awaiting_baseline' })).toBe(true)
    expect(isLearningContributor({ provisional: true, gap: 'no_input' })).toBe(true)
  })
  it('is false for a real score, provisional or not', () => {
    expect(isLearningContributor({ provisional: false, gap: null })).toBe(false)
    expect(isLearningContributor({ provisional: true, gap: null })).toBe(false)
    expect(isLearningContributor({ provisional: true, gap: null, scale: 'oura_contributor' })).toBe(false)
  })
  it('keeps provisional\'s old meaning on a payload without gap', () => {
    expect(isLearningContributor({ provisional: true })).toBe(true)
    expect(isLearningContributor({ provisional: false })).toBe(false)
    expect(isLearningContributor({})).toBe(false)
  })
})
