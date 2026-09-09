import { describe, expect, it } from 'vitest'
import { latestReading, readingGroups, METRIC_GROUPS, type MetricRow } from '../measured-overview'

const rows: MetricRow[] = [
  { date: '2026-09-01', weightKg: 90.4, bodyFatPct: 22.1, steps: 8000, waistCm: null },
  { date: '2026-09-05', weightKg: 89.9, bodyFatPct: null, steps: 9123, waistCm: null },
  { date: '2026-09-08', weightKg: null, bodyFatPct: null, steps: 4200, waistCm: null },
]

describe('latestReading — BF-133', () => {
  const spec = { field: 'weightKg', label: 'Weight', unit: 'kg', dp: 1 }

  it('takes the most recent row that actually carries a number', () => {
    // Not the most recent row: 2026-09-08 has a step count and no weight.
    expect(latestReading(rows, spec)).toEqual({
      label: 'Weight', value: '89.9 kg', asOf: '2026-09-05', note: undefined,
    })
  })

  it('does not depend on the rows arriving in order', () => {
    expect(latestReading([...rows].reverse(), spec)?.asOf).toBe('2026-09-05')
  })

  it('is null for a column nothing has ever written, rather than a blank row', () => {
    // The six tape-measure columns are exactly this case in production.
    expect(latestReading(rows, { field: 'waistCm', label: 'Waist', unit: 'cm' })).toBeNull()
    expect(latestReading(rows, { field: 'neverHeardOfIt', label: 'X' })).toBeNull()
  })

  it('ignores a non-finite value instead of rendering NaN', () => {
    const bad: MetricRow[] = [{ date: '2026-09-09', weightKg: Number.NaN }]
    expect(latestReading([...rows, ...bad], spec)?.asOf).toBe('2026-09-05')
  })

  it('rounds to the places the metric deserves and appends its unit', () => {
    expect(latestReading(rows, { field: 'steps', label: 'Steps' })?.value).toBe('4,200')
    expect(latestReading(rows, { field: 'bodyFatPct', label: 'Body fat', unit: '%', dp: 1 })?.value)
      .toBe('22.1 %')
  })

  it('carries the note through, because some numbers are not what their name implies', () => {
    const spec2 = { field: 'weightKg', label: 'Weight', note: 'estimated' }
    expect(latestReading(rows, spec2)?.note).toBe('estimated')
  })
})

describe('readingGroups — BF-133', () => {
  it('drops a group whose every metric is absent, rather than showing an empty heading', () => {
    const titles = readingGroups(rows).map(g => g.title)
    expect(titles).toContain('Body composition')
    expect(titles).toContain('Daily movement')
    // Nothing in `rows` carries a vital or a metabolic figure.
    expect(titles).not.toContain('Vitals')
    expect(titles).not.toContain('Metabolism')
  })

  it('drops the absent metrics inside a group it keeps', () => {
    const comp = readingGroups(rows).find(g => g.title === 'Body composition')!
    expect(comp.readings.map(r => r.label)).toEqual(['Weight', 'Body fat'])
  })

  it('returns nothing at all when there are no rows', () => {
    expect(readingGroups([])).toEqual([])
  })

  it('says which resting rate the scale one is, since the app holds two', () => {
    const spec = METRIC_GROUPS.flatMap(g => g.specs).find(s => s.field === 'bmrKcal')!
    expect(spec.note).toMatch(/estimated by the scale/)
  })

  it('names the window the heart rate describes rather than calling it "heart rate"', () => {
    const labels = METRIC_GROUPS.flatMap(g => g.specs).map(s => s.label)
    expect(labels).toContain('Resting heart rate')
    expect(labels).not.toContain('Heart rate')
  })
})

import { sleepAverages, circularMeanMinutes, clockFromMinutes, type SleepNight } from '../measured-overview'

const night = (date: string, o: Partial<SleepNight> = {}): SleepNight => ({
  date, durationHours: 7, efficiency: 85, sleepStart: `${date}T23:00:00.000Z`,
  lowestHeartRate: 48, respiratoryRate: 14, ...o,
})

describe('circularMeanMinutes — BF-133', () => {
  // Minutes-of-day straight off the ISO string, which is what the UTC fixtures below mean.
  const utc = (iso: string) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes() }

  it('averages across midnight instead of through noon', () => {
    // The failure this exists to prevent: a plain mean of 23:50 and 00:10 is 12:00 — the middle of
    // the next day, and a number that looks like a real bedtime.
    const m = circularMeanMinutes(['2026-09-01T23:50:00Z', '2026-09-02T00:10:00Z'], utc)!
    expect(clockFromMinutes(m)).toBe('00:00')
  })

  it('still gives the ordinary answer when nothing straddles midnight', () => {
    const m = circularMeanMinutes(['2026-09-01T22:00:00Z', '2026-09-02T23:00:00Z'], utc)!
    expect(clockFromMinutes(m)).toBe('22:30')
  })

  it('has no answer for times that cancel, rather than picking an end of the ambiguity', () => {
    expect(circularMeanMinutes(['2026-09-01T00:00:00Z', '2026-09-01T12:00:00Z'], utc)).toBeNull()
  })

  it('ignores nights with no recorded start', () => {
    expect(circularMeanMinutes([null, '2026-09-01T22:00:00Z'], utc)).not.toBeNull()
    expect(circularMeanMinutes([null, null], utc)).toBeNull()
  })
})

describe('sleepAverages — BF-133', () => {
  it('averages only the nights that carry each figure, and counts the nights', () => {
    const avg = sleepAverages([
      night('2026-09-01', { durationHours: 6 }),
      night('2026-09-02', { durationHours: 8, efficiency: null }),
    ])!
    expect(avg.nights).toBe(2)
    expect(avg.durationHours).toBe(7)
    // One night has no efficiency; averaging it as zero would be the unknown-coerced-to-zero bug.
    expect(avg.efficiency).toBe(85)
  })

  it('is null for a figure no night carries, rather than zero', () => {
    const avg = sleepAverages([night('2026-09-01', { respiratoryRate: null })])!
    expect(avg.respiratoryRate).toBeNull()
  })

  it('has nothing to say with no nights at all', () => {
    expect(sleepAverages([])).toBeNull()
  })
})
