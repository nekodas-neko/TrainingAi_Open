import { describe, it, expect } from 'vitest'
import { buildInsightText } from '../insight-text'

describe('buildInsightText', () => {
  it('leads with the headline and its band', () => {
    expect(buildInsightText({ headline: { label: 'Readiness', value: '72/100', band: 'good' }, lines: [], absent: [] }))
      .toBe('Readiness is 72/100 (good).')
  })

  it('omits the band when there is none — a bpm has no 0-100 band to name', () => {
    expect(buildInsightText({ headline: { label: 'Resting heart rate', value: '52 bpm', band: null }, lines: [], absent: [] }))
      .toBe('Resting heart rate is 52 bpm.')
  })

  it('keeps an acronym in the contributor name', () => {
    const text = buildInsightText({ lines: [], absent: [], weakest: { label: 'HRV balance', value: 58 } })
    expect(text).toContain('HRV balance at 58/100')
    expect(text).not.toContain('hrv balance')
  })
})

describe('placing today against the recent values', () => {
  const base = { lines: [], absent: [] }

  it('calls a higher score the better side', () => {
    const text = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [70, 71, 72], today: 80 } })
    expect(text).toContain('above the recent readings (median 71), which is the better side')
  })

  // A resting heart rate is the inverse: lower is the good direction, and saying "below … the
  // weaker side" of a 52 against a 55 baseline would invert the meaning of the whole sentence.
  it('flips the judgement when lower is better', () => {
    const text = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [55, 56, 57], today: 52, lowerIsBetter: true } })
    expect(text).toContain('below the recent readings (median 56), which is the better side')
  })

  it('calls a sub-point difference in line rather than a movement', () => {
    const text = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [70, 71, 72], today: 71.4 } })
    expect(text).toContain('in line with the recent readings (median 71)')
    expect(text).not.toMatch(/above|below/)
  })

  it('says nothing when the series is too short to place today against', () => {
    const text = buildInsightText({ ...base, headline: { label: 'Readiness', value: '72/100' }, recent: { noun: 'the recent readings', values: [70, 71], today: 80 } })
    expect(text).toBe('Readiness is 72/100.')
  })

  it('says nothing when today itself was not measured', () => {
    const text = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [70, 71, 72], today: null } })
    expect(text).toBe('')
  })

  it('uses the median, so one outlier does not move what today is judged against', () => {
    const withOutlier = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [70, 71, 72, 73, 300], today: 74 } })
    const without = buildInsightText({ ...base, recent: { noun: 'the recent readings', values: [70, 71, 72, 73, 74], today: 74 } })
    // The mean of the first series is 117; a mean-based baseline would call 74 far below it.
    expect(withOutlier).toContain('above')
    expect(withOutlier).toBe(without)
  })
})

describe('the stale note', () => {
  it('leads, so the reader sees the readings are not today\'s before reading them', () => {
    const text = buildInsightText({
      headline: { label: 'Readiness', value: '72/100', band: 'good' },
      lines: [], absent: [],
      staleNote: 'NOTE: Oura daily fields below are from 2026-09-20.',
    })
    expect(text.startsWith('NOTE: Oura daily fields below are from 2026-09-20.')).toBe(true)
    expect(text).toContain('Readiness is 72/100 (good).')
  })
})
