import { describe, it, expect } from 'vitest'
import {
  estimateMaintenance, resolveMaintenance, maintenanceGapMessage,
  MIN_LOGGED_DAYS, MIN_WEIGH_INS, DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS, MIN_PLAUSIBLE_MAINTENANCE,
  type MaintenanceDay,
} from '../adaptive-tdee'

/** Fixed calendar day `i` days after 2026-01-01, built without toISOString (which is UTC-based
 *  and banned repo-wide). Both sides of every assertion derive from this — no real clock. */
function dayStr(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** A window where every day is logged at `intake` and weight moves linearly by `kgTotal`.
 *
 *  Q-387: a logged day now also has to be a day the user marked finished, so this helper stamps
 *  `loggingComplete` wherever it stamps an intake. Every test below was written before that flag
 *  existed and means "the user logged this day properly" — which is what the flag says. The
 *  half-logged case they never covered is its own describe block at the end. */
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
    loggingComplete: intake != null && i % logEvery === 0,
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

// Q-387 — the case this module was never tested for. It is well covered for EMPTY days and had
// zero coverage of HALF-FULL ones, which is why the bug survived: a day abandoned after lunch is
// byte-for-byte identical to a completed light day, and the mean cannot tell them apart.
describe('estimateMaintenance — partial days (Q-387)', () => {
  /** 14 days at a true 2,600 maintenance, weight perfectly flat. `partial` of them stop after
   *  lunch at 1,400 and were never marked complete. */
  const halfLogged = (partial: number): MaintenanceDay[] =>
    Array.from({ length: 14 }, (_, i) => ({
      date: dayStr(i),
      intakeKcal: i < partial ? 1400 : 2600,
      loggingComplete: i >= partial,
      weightKg: 80,
    }))

  it('no longer drags the mean down — the measured 86 kcal per partial day is gone', () => {
    // Before the flag: 0 partial → 2600, 6 partial → 2086, 14 partial → 1400, every row
    // `confidence: 'medium'` and `excludedReason: null`. 514 kcal low at a realistic 6-of-14, and
    // it looked exactly as trustworthy as a correct answer.
    expect(estimateMaintenance(halfLogged(0), 14).maintenanceKcal).toBe(2600)
    // 4 partial still leaves 10 complete days — the gate is met and the mean is now the truth,
    // where before it read 2,257.
    expect(estimateMaintenance(halfLogged(4), 14).maintenanceKcal).toBe(2600)
  })

  it('counts only the completed days towards the gate, and waits when that drops below it', () => {
    const r = estimateMaintenance(halfLogged(6), 14)
    expect(r.daysLogged).toBe(8)
    // This is the point of the change, not a shortcoming of it: 8 of 10 is "not enough data yet",
    // and the honest answer is silence. The old code answered 2,086 with `confidence: 'medium'`.
    expect(r.maintenanceKcal).toBeNull()
  })

  it('waits rather than answers when too few days are complete', () => {
    // The failure mode has to be "not enough data", not "a confident wrong number" — this used to
    // return a plausible-looking 1400 with nothing flagged.
    const r = estimateMaintenance(halfLogged(14), 14)
    expect(r.daysLogged).toBe(0)
    expect(r.maintenanceKcal).toBeNull()
    expect(r.excludedReason).not.toBeNull()
  })

  it('excludes a day with an intake but no flag — absent is not "assumed complete"', () => {
    const days: MaintenanceDay[] = Array.from({ length: 14 }, (_, i) => ({
      date: dayStr(i), intakeKcal: 2600, weightKg: 80,
    }))
    expect(estimateMaintenance(days, 14).daysLogged).toBe(0)
  })

  it('excludes a day marked complete that carries no intake at all', () => {
    // Marking an empty day complete must not create a zero-calorie day — that would poison the
    // mean in the opposite direction, which is the trap `intakeKcal: null` already guards.
    const days: MaintenanceDay[] = Array.from({ length: 14 }, (_, i) => ({
      date: dayStr(i), intakeKcal: i < 4 ? null : 2600, loggingComplete: true, weightKg: 80,
    }))
    const r = estimateMaintenance(days, 14)
    expect(r.daysLogged).toBe(10)
    expect(r.maintenanceKcal).toBe(2600)
  })
})

// Q-517: the universal 1000 kcal floor sits below the real artefact. The owner's worst window
// computed 1052 — 495 kcal under a BMR of 1547 — and one tap turns that into a calorie goal.
describe('the BMR floor', () => {
  /** A window computing a maintenance of ~1050: logged at 1200/day, losing weight slowly. */
  const artefact = () => window({ days: 14, intake: 1200, kgTotal: -0.27 })

  it('reproduces the artefact when no BMR is supplied — this is the shipped behaviour', () => {
    const e = estimateMaintenance(artefact(), 14)
    expect(e.maintenanceKcal).not.toBeNull()
    expect(e.maintenanceKcal!).toBeGreaterThan(MIN_PLAUSIBLE_MAINTENANCE)
    expect(e.maintenanceKcal!).toBeLessThan(1547)
  })

  it('refuses the same window once the user\'s own BMR is the floor', () => {
    const e = estimateMaintenance(artefact(), 14, 1547)
    expect(e.maintenanceKcal).toBeNull()
    expect(e.excludedReason).toBe('below_bmr')
  })

  it('rejects rather than clamps — resolveMaintenance falls back to the formula baseline', () => {
    const r = resolveMaintenance(artefact(), 2397, 1547)
    expect(r.source).toBe('formula')
    expect(r.maintenanceKcal).toBe(2397)
  })

  it('leaves a healthy window alone', () => {
    const ok = window({ days: 14, intake: 2400 })
    expect(estimateMaintenance(ok, 14, 1547).maintenanceKcal)
      .toBe(estimateMaintenance(ok, 14).maintenanceKcal)
  })

  it('never lowers the universal floor, whatever BMR it is handed', () => {
    // A nonsense BMR must not weaken the guard that already exists.
    const e = estimateMaintenance(window({ days: 14, intake: 2000, kgTotal: 5 }), 14, 200)
    expect(e.maintenanceKcal).toBeNull()
    expect(e.excludedReason).toBe('implausible_result')
  })

  it('still calls an out-of-range HIGH value implausible, not below_bmr', () => {
    const e = estimateMaintenance(window({ days: 14, intake: 2000, kgTotal: -12 }), 14, 1547)
    expect(e.excludedReason).toBe('implausible_result')
  })

  it('explains itself to the user without naming the internal gate', () => {
    const e = estimateMaintenance(artefact(), 14, 1547)
    expect(maintenanceGapMessage(e)).toMatch(/resting burn/i)
  })
})
