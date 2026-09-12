import { describe, it, expect } from 'vitest'
import {
  trendDelta, deltaSentence, trendSeries, trendRows, trendRowsFor, TREND_SPECS,
  TREND_TIME_DOMAIN, TREND_WEEK_TIME_DOMAIN,
} from '../day-trends'
import type { WeekWindowDay, WeekWindowResponse } from '@/app/api/day-review/week-window/route'
import type { MonthWindowResponse, MonthWindowWeek } from '@/app/api/weekly-review/month-window/route'

const spec = (key: string) => TREND_SPECS.find(s => s.key === key)!

function day(i: number, over: Partial<WeekWindowDay> = {}): WeekWindowDay {
  return {
    date: `2026-09-0${i + 1}`,
    restingHeartRate: null, steps: null, sessionVolumeKg: null, weightKg: null,
    ...over,
  }
}

function response(days: WeekWindowDay[], averages: Partial<WeekWindowResponse['sevenDayAverages']> = {}): WeekWindowResponse {
  return {
    date: days[days.length - 1].date,
    days,
    sevenDayAverages: {
      restingHeartRate: null, steps: null, sessionVolumeKg: null, weightKg: null, ...averages,
    },
  }
}

describe('trendDelta', () => {
  it('carries the sign in the direction, never in the magnitude', () => {
    expect(trendDelta(60, 55)).toEqual({ direction: 'up', magnitude: 5 })
    expect(trendDelta(55, 60)).toEqual({ direction: 'down', magnitude: 5 })
  })

  // The distinction this is here for: a missing reading and a reading that happens to equal the
  // average are different statements, and flattening a null to 0 makes them render identically.
  it('is null when either side is missing, which is not the same as level', () => {
    expect(trendDelta(null, 55)).toBeNull()
    expect(trendDelta(60, null)).toBeNull()
    expect(trendDelta(null, null)).toBeNull()
    expect(trendDelta(55, 55)).toEqual({ direction: 'level', magnitude: 0 })
  })

  it('calls a difference level once it rounds away at the precision it would print at', () => {
    // Weight is the tightest of the four at one decimal, so 0.05 is the threshold for all of them.
    expect(trendDelta(80.02, 80)?.direction).toBe('level')
    expect(trendDelta(80.06, 80)?.direction).toBe('up')
  })
})

describe('deltaSentence', () => {
  it('says which way, in words, so the colour is never the only carrier', () => {
    expect(deltaSentence(spec('restingHeartRate'), { direction: 'up', magnitude: 4 }))
      .toBe('4 bpm above the last 7 days')
    expect(deltaSentence(spec('weightKg'), { direction: 'down', magnitude: 0.4 }))
      .toBe('0.4 kg below the last 7 days')
    expect(deltaSentence(spec('steps'), { direction: 'level', magnitude: 0 }))
      .toBe('Level with the last 7 days')
  })

  it('formats a delta at the precision of a difference, not of a level', () => {
    // 0.4 kg is not a body weight, but it is a change worth seeing — which is why the two
    // formatters are separate rather than one shared rounding.
    expect(spec('weightKg').formatDelta(0.4)).toBe('0.4 kg')
    expect(spec('steps').formatDelta(1234)).toBe('1,234')
  })
})

describe('trendSeries', () => {
  it('keeps each point at the day it was recorded, rather than closing the gaps', () => {
    const days = [day(0, { steps: 100 }), day(1), day(2), day(3, { steps: 400 })]
    expect(trendSeries(days, 'steps')).toEqual({ values: [100, 400], times: [0, 3] })
  })

  it('refuses a series the primitive cannot draw', () => {
    expect(trendSeries([day(0, { steps: 100 }), day(1)], 'steps')).toBeNull()
    expect(trendSeries([day(0), day(1)], 'steps')).toBeNull()
  })
})

describe('trendRows', () => {
  const eight = (over: (i: number) => Partial<WeekWindowDay>) =>
    Array.from({ length: 8 }, (_, i) => day(i, over(i)))

  it('omits a stat with no reading anywhere, and keeps one with history but nothing today', () => {
    const days = eight(i => (i < 6 ? { steps: 1000 * (i + 1) } : {}))
    const rows = trendRows(response(days, { steps: 3500 }))
    expect(rows.map(r => r.spec.key)).toEqual(['steps'])
    const steps = rows[0]
    expect(steps.today).toBeNull()
    // No today reading means no delta — but the week is still an answer, so the row stays.
    expect(steps.delta).toBeNull()
    expect(steps.series?.values).toHaveLength(6)
  })

  it('keeps a stat recorded only today, even though there is nothing to draw', () => {
    const days = eight(i => (i === 7 ? { weightKg: 80 } : {}))
    const rows = trendRows(response(days))
    expect(rows.map(r => r.spec.key)).toEqual(['weightKg'])
    expect(rows[0].series).toBeNull()
    expect(rows[0].today).toBe(80)
  })

  it('returns nothing at all for a window that recorded nothing', () => {
    expect(trendRows(response(eight(() => ({}))))).toEqual([])
  })

  it('compares today against the average the route computed, not one it re-derives', () => {
    const days = eight(i => ({ restingHeartRate: i === 7 ? 62 : 55 }))
    // The route's mean deliberately EXCLUDES today; a row that re-averaged the eight points it was
    // handed would get 55.875 and report a smaller move than actually happened.
    const rows = trendRows(response(days, { restingHeartRate: 55 }))
    expect(rows[0].delta).toEqual({ direction: 'up', magnitude: 7 })
  })

  it('orders the rows as the specs do, so the sheet does not reshuffle day to day', () => {
    const days = eight(() => ({ restingHeartRate: 55, steps: 9000, sessionVolumeKg: 5000, weightKg: 80 }))
    expect(trendRows(response(days)).map(r => r.spec.key))
      .toEqual(['restingHeartRate', 'steps', 'sessionVolumeKg', 'weightKg'])
  })
})

/**
 * Q-112e widened these functions to serve the weekly recap's five-week window as well as the day
 * review's eight days. What follows pins the widening itself: that the maths is genuinely shared
 * rather than forked, and that the two windows stay distinguishable where they must.
 */
function week(i: number, over: Partial<MonthWindowWeek> = {}): MonthWindowWeek {
  return {
    weekStart: `2026-08-0${i + 1}`,
    restingHeartRate: null, steps: null, sessionVolumeKg: null, weightKg: null,
    ...over,
  }
}

function monthResponse(
  weeks: MonthWindowWeek[],
  priors: Partial<MonthWindowResponse['priorAverages']> = {},
): MonthWindowResponse {
  return {
    weekStart: weeks[weeks.length - 1].weekStart,
    weeks,
    priorAverages: {
      restingHeartRate: null, steps: null, sessionVolumeKg: null, weightKg: null, ...priors,
    },
  }
}

const five = (f: (i: number) => Partial<MonthWindowWeek>) =>
  Array.from({ length: 5 }, (_, i) => week(i, f(i)))

describe('trendRowsFor — the weekly recap window', () => {
  const rowsOf = (data: MonthWindowResponse) =>
    trendRowsFor({ points: data.weeks, priorAverages: data.priorAverages })

  it('reports the LAST week, not the first, and judges it against the prior average', () => {
    // The five points are ascending and the fifth is the week being recapped. Reading the wrong end
    // is the failure this window makes easy — the daily one is eight points and looks different.
    const data = monthResponse(five(i => ({ restingHeartRate: i === 4 ? 62 : 55 })), { restingHeartRate: 55 })
    const rows = rowsOf(data)
    expect(rows[0].today).toBe(62)
    expect(rows[0].delta).toEqual({ direction: 'up', magnitude: 7 })
  })

  it('keeps a week at the index it was recorded, so a gap draws as a gap', () => {
    const data = monthResponse(five(i => (i % 2 === 0 ? { steps: 9000 + i } : {})))
    expect(rowsOf(data)[0].series).toEqual({ values: [9000, 9002, 9004], times: [0, 2, 4] })
  })

  it('omits a stat no week recorded, and keeps one with history but nothing this week', () => {
    const data = monthResponse(five(i => (i < 4 ? { weightKg: 80 } : {})))
    const rows = rowsOf(data)
    expect(rows.map(r => r.spec.key)).toEqual(['weightKg'])
    expect(rows[0].today).toBeNull()
  })

  it('is the same function the day review uses, over the same four specs in the same order', () => {
    const data = monthResponse(five(() => ({ restingHeartRate: 55, steps: 9000, sessionVolumeKg: 5000, weightKg: 80 })))
    expect(rowsOf(data).map(r => r.spec.key))
      .toEqual(['restingHeartRate', 'steps', 'sessionVolumeKg', 'weightKg'])
  })

  it('agrees with trendRows given the same numbers, which is what "widened, not forked" means', () => {
    const shared = [{ steps: 8000 }, { steps: 9000 }]
    const viaDay = trendRowsFor({ points: shared, priorAverages: { steps: 8000 } })
    const viaWeek = trendRowsFor({ points: shared, priorAverages: { steps: 8000 } })
    expect(viaWeek).toEqual(viaDay)
    expect(viaWeek[0].delta).toEqual({ direction: 'up', magnitude: 1000 })
  })
})

describe('the two windows stay distinguishable', () => {
  it('names what a delta is measured against, so a week is never described as a day', () => {
    const d = trendDelta(62, 55)!
    expect(deltaSentence(spec('restingHeartRate'), d)).toBe('7 bpm above the last 7 days')
    expect(deltaSentence(spec('restingHeartRate'), d, 'the last 4 weeks'))
      .toBe('7 bpm above the last 4 weeks')
    expect(deltaSentence(spec('steps'), { direction: 'level', magnitude: 0 }, 'the last 4 weeks'))
      .toBe('Level with the last 4 weeks')
  })

  it('projects each window into its own domain, so five weeks do not draw as eight days', () => {
    // Sharing one domain would squash the recap's five points into the left five-eighths of the
    // chart while the daily one fills it.
    expect(TREND_TIME_DOMAIN).toEqual([0, 7])
    expect(TREND_WEEK_TIME_DOMAIN).toEqual([0, 4])
  })
})
