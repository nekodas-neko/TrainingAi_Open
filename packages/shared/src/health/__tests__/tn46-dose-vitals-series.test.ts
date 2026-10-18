import { describe, it, expect } from 'vitest'
import {
  buildDoseVitalsSeries, hasAnyReading, doseLabel, METRIC_LABEL,
  type DoseVitalsNightInput,
} from '../dose-vitals-series'

const night = (date: string, rhr: number | null, hrv: number | null): DoseVitalsNightInput => ({
  date, restingHr: rhr, hrvMs: hrv, restingHrBaseline: 53, hrvBaseline: 40,
})

const NIGHTS = [
  night('2026-09-01', 52, 41),
  night('2026-09-02', 54, 38),
  night('2026-09-03', 55, 36),
  night('2026-09-06', 53, 40),
  night('2026-09-07', 52, 42),
]
const DOSES = [{ supplementName: 'Testosterone', date: '2026-09-01', amount: 0.4, unit: 'mL' }]

describe('TN-46 — the lag rule is the point of the overlay', () => {
  it('does NOT put the dose night itself in the effect window', () => {
    // The measured effect peaks 2–4 days out. A same-day reading is the wrong inference, and the
    // chart must not offer it: the dose day is marked as a dose, never as an effect.
    const s = buildDoseVitalsSeries(NIGHTS, DOSES, 'rhr', 5)
    const doseDay = s.find(p => p.date === '2026-09-01')!
    expect(doseDay.dosedOn).toBe(true)
    expect(doseDay.inEffectWindow).toBe(false)
  })

  it('covers the following days out to the lookback, and stops there', () => {
    const s = buildDoseVitalsSeries(NIGHTS, DOSES, 'rhr', 5)
    expect(s.find(p => p.date === '2026-09-02')!.inEffectWindow).toBe(true)
    expect(s.find(p => p.date === '2026-09-06')!.inEffectWindow).toBe(true)  // +5, the last day
    expect(s.find(p => p.date === '2026-09-07')!.inEffectWindow).toBe(false) // +6, outside
  })

  it('walks the calendar with the shared helper, so a month end does not produce an invalid date', () => {
    const s = buildDoseVitalsSeries(
      [night('2026-07-01', 50, 44)],
      [{ supplementName: 'T', date: '2026-06-29', amount: 1, unit: null }],
      'rhr', 5,
    )
    // 2026-06-29 + 2 is 2026-07-01, not "2026-06-31" — the shape that 500'd the workout screen.
    expect(s[0].inEffectWindow).toBe(true)
  })

  it('picks the metric and its own baseline together', () => {
    const rhr = buildDoseVitalsSeries(NIGHTS, DOSES, 'rhr', 5)[0]
    const hrv = buildDoseVitalsSeries(NIGHTS, DOSES, 'hrv', 5)[0]
    expect([rhr.value, rhr.baseline]).toEqual([52, 53])
    expect([hrv.value, hrv.baseline]).toEqual([41, 40])
  })

  it('reports a series with no readings, so the card can say so instead of drawing empty axes', () => {
    expect(hasAnyReading(buildDoseVitalsSeries(NIGHTS, DOSES, 'rhr', 5))).toBe(true)
    expect(hasAnyReading(buildDoseVitalsSeries(
      [night('2026-09-01', null, null)], DOSES, 'rhr', 5,
    ))).toBe(false)
  })

  it('labels a dose from the log amount, and survives a missing unit', () => {
    expect(doseLabel(DOSES[0])).toBe('Testosterone · 0.4 mL')
    expect(doseLabel({ supplementName: 'T', date: 'x', amount: 1, unit: null })).toBe('T · 1')
    expect(METRIC_LABEL.rhr).toBe('Resting HR')
  })
})

describe('TN-46 — the dose list is sorted here, not trusted', () => {
  it('returns the most recent first whatever order the route used', async () => {
    const { latestDoses } = await import('../dose-vitals-series')
    const d = (date: string) => ({ supplementName: 'T', date, amount: 1, unit: 'mL' })
    // Ascending in, descending out — and the same for descending in, which is what the route
    // happens to do today. A list captioned "most recent" must not depend on that.
    expect(latestDoses([d('2026-09-01'), d('2026-09-13'), d('2026-09-20')]).map(x => x.date))
      .toEqual(['2026-09-20', '2026-09-13', '2026-09-01'])
    expect(latestDoses([d('2026-09-20'), d('2026-09-13'), d('2026-09-01')]).map(x => x.date))
      .toEqual(['2026-09-20', '2026-09-13', '2026-09-01'])
    expect(latestDoses([d('2026-09-01'), d('2026-09-13'), d('2026-09-20'), d('2026-09-22')], 3).map(x => x.date))
      .toEqual(['2026-09-22', '2026-09-20', '2026-09-13'])
  })

  it('does not mutate the payload it was handed', async () => {
    const { latestDoses } = await import('../dose-vitals-series')
    const input = [{ supplementName: 'T', date: '2026-09-01', amount: 1, unit: null },
                   { supplementName: 'T', date: '2026-09-20', amount: 1, unit: null }]
    latestDoses(input)
    expect(input[0].date).toBe('2026-09-01')
  })
})
