// #3884: the coach tool's Oura resilience word is read through the generic `DailyResilienceLevel`
// shape. The old rule, written out on the same rows, must give the same days and words.
import { describe, expect, it } from 'vitest'
import { ouraResilienceLevels, ouraTemperatureDeviations } from '@/lib/oura/cloud/readiness-signals-map'

type Row = { date: string; resilienceLevel?: string | null }
const OURA: Row[] = [
  { date: '2026-11-01', resilienceLevel: 'solid' },
  { date: '2026-11-02', resilienceLevel: null },
  { date: '2026-11-03' },
  { date: '2026-11-04', resilienceLevel: 'limited' },
  { date: '2026-11-05', resilienceLevel: 'strong' },
]
// The app's own level exists for 2 Nov and 4 Nov only.
const OWN = new Map<string, { resilienceLevel: number | null }>([
  ['2026-11-02', { resilienceLevel: 3 }], ['2026-11-04', { resilienceLevel: 2 }],
])

const before = (oura: Row[]) => oura
  .filter(r => r.resilienceLevel != null && OWN.get(r.date)?.resilienceLevel == null)
  .map(r => ({ date: r.date, level: r.resilienceLevel }))
const after = (oura: Row[]) => ouraResilienceLevels(oura)
  .filter(r => OWN.get(r.date)?.resilienceLevel == null)
  .map(r => ({ date: r.date, level: r.level }))

describe('Oura resilience through the generic shape', () => {
  it('gives the same days and words as the old rule over the same rows', () => {
    expect(after(OURA)).toEqual(before(OURA))
    expect(after(OURA)).toEqual([{ date: '2026-11-01', level: 'solid' }, { date: '2026-11-05', level: 'strong' }])
  })

  it('labels each day with the connector source and drops empty days', () => {
    expect(ouraResilienceLevels(OURA)).toEqual([
      { date: '2026-11-01', level: 'solid', source: 'oura_cloud' },
      { date: '2026-11-04', level: 'limited', source: 'oura_cloud' },
      { date: '2026-11-05', level: 'strong', source: 'oura_cloud' },
    ])
  })
})

// The tool's temperature column: a day's value, or null; a day with only a null still lists the day.
describe('the coach tool\'s temperature column through the generic shape', () => {
  const rows = [{ date: '2026-11-01', temperatureDeviation: 0.3 }, { date: '2026-11-02', temperatureDeviation: null }, { date: '2026-11-03' }]
  it('gives the same per-day values and day list as reading the rows directly', () => {
    const before = new Map(rows.map(r => [r.date, r.temperatureDeviation ?? null]))
    const after = new Map(ouraTemperatureDeviations(rows).map(t => [t.date, t.deviationC]))
    const days = rows.map(r => r.date)
    expect(days.map(d => after.get(d) ?? null)).toEqual(days.map(d => before.get(d) ?? null))
  })
})
