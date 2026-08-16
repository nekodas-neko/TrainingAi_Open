import { describe, it, expect } from 'vitest'
import {
  estimateMaintenance, resolveMaintenance, maintenanceGapMessage,
  MIN_LOGGED_DAYS, MIN_WEIGH_INS, DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS,
  type MaintenanceDay,
} from '../adaptive-tdee'

/** Fixed calendar day `i` days after 2026-01-01, built without toISOString (which is UTC-based
 *  and banned repo-wide). Both sides of every assertion derive from this — no real clock. */
function dayStr(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** A window where every day is logged at `intake` and weight moves linearly by `kgTotal`. */
function window(opts: {
  days: number
  intake: number | null
  kgStart?: number
  kgTotal?: number
  logEvery?: number
  weighEvery?: number
}): MaintenanceDay[] {
  const { days, intake, kgStart = 80, kgTotal = 0, logEvery = 1, weighEvery = 1 } = opts
  return Array.from({ length: days }, (_, i) => ({
    date: dayStr(i),
    intakeKcal: intake != null && i % logEvery === 0 ? intake : null,
    weightKg: i % weighEvery === 0 ? kgStart + (kgTotal * i) / (days - 1) : null,
  }))
}

describe('estimateMaintenance — the maths', () => {
  it('returns mean intake when weight is flat', () => {
    const e = estimateMaintenance(window({ days: 14, intake: 2000, kgTotal: 0 }), 14)
    expect(e.maintenanceKcal).toBe(2000)
    expect(e.excludedReason).toBeNull()
  })

  it('reports maintenance ABOVE intake when weight is falling', () => {
    // The fixture spreads 1 kg across 13 intervals → 7700/13 ≈ 592 kcal/day of extra burn.
    const e = estimateMaintenance(window({ days: 14, intake: 2000, kgTotal: -1 }), 14)
    expect(e.maintenanceKcal).toBeGreaterThan(2000)
    expect(e.maintenanceKcal).toBeCloseTo(2592, -1)
    expect(e.weightRateKgPerWeek).toBeCloseTo(-0.54, 1)
  })

  it('reports maintenance BELOW intake when weight is rising', () => {
    const e = estimateMaintenance(window({ days: 14, intake: 2500, kgTotal: 1 }), 14)
    expect(e.maintenanceKcal).toBeLessThan(2500)
    expect(e.maintenanceKcal).toBeCloseTo(1908, -1)
  })

  it('fits the weight slope on calendar days, not on reading index', () => {
    // Two readings 10 days apart must give the same rate as if weighed daily.
    const sparse = window({ days: 14, intake: 2000, kgTotal: -1, weighEvery: 3 })
    const dense = window({ days: 14, intake: 2000, kgTotal: -1 })
    expect(sparse.filter(d => d.weightKg != null).length).toBeLessThan(
      dense.filter(d => d.weightKg != null).length,
    )
    expect(estimateMaintenance(sparse, 14).weightRateKgPerWeek)
      .toBeCloseTo(estimateMaintenance(dense, 14).weightRateKgPerWeek!, 1)
  })

  it('only uses the trailing window even when given more history', () => {
    const long = window({ days: 60, intake: 2000, kgTotal: 0 })
    expect(estimateMaintenance(long, 14).daysInWindow).toBe(14)
  })

  it('is order-independent', () => {
    const w = window({ days: 14, intake: 2000, kgTotal: -1 })
    const shuffled = [...w].reverse()
    expect(estimateMaintenance(shuffled, 14).maintenanceKcal)
      .toBe(estimateMaintenance(w, 14).maintenanceKcal)
  })
})

describe('estimateMaintenance — the gates', () => {
  it('refuses when too few days carry a food log', () => {
    const e = estimateMaintenance(window({ days: 14, intake: 2000, logEvery: 3 }), 14)
    expect(e.maintenanceKcal).toBeNull()
    expect(e.excludedReason).toBe('not_enough_logged_days')
  })

  it('never treats an unlogged day as a zero-calorie day', () => {
    // 7 logged days at 2000 among 14. If nulls counted as 0 the mean would halve to ~1000
    // and the estimate would tell the user their maintenance is starvation-level.
    const e = estimateMaintenance(window({ days: 14, intake: 2000, logEvery: 2 }), 14)
    expect(e.meanIntakeKcal).toBe(2000)
    expect(e.maintenanceKcal).toBeNull()
  })

  it('refuses a sparse long window that clears the raw logged-day count', () => {
    // 10 logged days out of 28 passes MIN_LOGGED_DAYS but fails the coverage fraction.
    const days = window({ days: 28, intake: 2000, kgTotal: -1 }).map((d, i) => ({
      ...d, intakeKcal: i < 10 ? 2000 : null,
    }))
    const e = estimateMaintenance(days, 28)
    expect(e.daysLogged).toBe(10)
    expect(e.daysLogged).toBeGreaterThanOrEqual(MIN_LOGGED_DAYS)
    expect(e.excludedReason).toBe('logging_too_sparse')
  })

  it('refuses without enough weigh-ins', () => {
    const days = window({ days: 14, intake: 2000 }).map((d, i) => ({
      ...d, weightKg: i < 2 ? 80 : null,
    }))
    const e = estimateMaintenance(days, 14)
    expect(e.weighIns).toBeLessThan(MIN_WEIGH_INS)
    expect(e.excludedReason).toBe('not_enough_weigh_ins')
  })

  it('refuses when the weigh-ins are bunched into a few days', () => {
    const days = window({ days: 14, intake: 2000 }).map((d, i) => ({
      ...d, weightKg: i < 5 ? 80 - i * 0.1 : null,
    }))
    const e = estimateMaintenance(days, 14)
    expect(e.excludedReason).toBe('weight_span_too_short')
  })

  it('refuses an implausible result rather than reporting it', () => {
    // 5 kg of water weight gained across the window at a modest intake computes to a NEGATIVE
    // maintenance. Reporting it would tell the user to eat nothing — the gate must swallow it.
    const e = estimateMaintenance(window({ days: 14, intake: 2000, kgTotal: 5 }), 14)
    expect(e.maintenanceKcal).toBeNull()
    expect(e.excludedReason).toBe('implausible_result')
  })

  it('grades confidence by coverage and window length', () => {
    expect(estimateMaintenance(window({ days: 28, intake: 2000 }), 28).confidence).toBe('high')
    expect(estimateMaintenance(window({ days: 14, intake: 2000 }), 14).confidence).toBe('medium')
  })
})

describe('resolveMaintenance', () => {
  it('falls back to the formula baseline when nothing is logged', () => {
    const r = resolveMaintenance([], 2100)
    expect(r.source).toBe('formula')
    expect(r.maintenanceKcal).toBe(2100)
  })

  it('prefers the calibrated number once the data supports it', () => {
    const r = resolveMaintenance(window({ days: 28, intake: 2000, kgTotal: -1 }), 2100)
    expect(r.source).toBe('calibrated')
    expect(r.maintenanceKcal).not.toBe(2100)
  })

  it('uses the 14-day window when 28 days of coverage is not there yet', () => {
    // Logged only over the most recent 14 days of a 28-day history.
    const days = window({ days: 28, intake: 2000, kgTotal: -1 }).map((d, i) => ({
      ...d,
      intakeKcal: i >= 14 ? 2000 : null,
      weightKg: i >= 14 ? d.weightKg : null,
    }))
    const r = resolveMaintenance(days, 2100)
    expect(r.source).toBe('calibrated')
    expect(r.estimate.daysInWindow).toBe(DEFAULT_WINDOW_DAYS)
  })

  it('reports the short window in the gap message so the countdown is reachable', () => {
    const days = window({ days: MAX_WINDOW_DAYS, intake: 2000 }).map((d, i) => ({
      ...d, intakeKcal: i >= 22 ? 2000 : null,
    }))
    const r = resolveMaintenance(days, 2100)
    expect(r.source).toBe('formula')
    expect(r.estimate.daysInWindow).toBe(DEFAULT_WINDOW_DAYS)
  })
})

describe('maintenanceGapMessage', () => {
  it('counts down the days still needed', () => {
    const e = estimateMaintenance(window({ days: 14, intake: 2000, logEvery: 7 }), 14)
    expect(maintenanceGapMessage(e)).toContain(`${MIN_LOGGED_DAYS - e.daysLogged} more day`)
  })

  it('pluralises correctly at one day remaining', () => {
    const days = window({ days: 14, intake: 2000 }).map((d, i) => ({
      ...d, intakeKcal: i < MIN_LOGGED_DAYS - 1 ? 2000 : null,
    }))
    expect(maintenanceGapMessage(estimateMaintenance(days, 14))).toContain('1 more day to')
  })
})
