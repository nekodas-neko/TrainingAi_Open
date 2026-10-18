import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import {
  recoveryResponse,
  RECOVERY_MIN_CYCLES,
  RECOVERY_MIN_NIGHTS_PER_CYCLE,
  type RecoveryDose,
  type RecoveryNight,
  type MetricRecoveryResponse,
} from '../weight-response'

/**
 * Issue 2152 — the recovery-response model. The fixture has a KNOWN response built in (resting HR
 * +3 bpm and HRV -8 ms on days 1 and 2 after each dose, nothing else), so every expected number
 * below is arithmetic on that, not a snapshot of whatever the function printed.
 */

const TZ = 'Australia/Brisbane'
const SUBSTANCE = 'sub-reta'
const BASE_RHR = 55
const BASE_HRV = 50

/** Pre-dose wobble 54/55/56 repeating: symmetric, so the median is exactly the base. */
const wobble = (i: number) => (i % 3) - 1

const dose = (date: string, amount: number | null = 1, takenAt: string | null = null): RecoveryDose => ({
  supplementId: SUBSTANCE, supplementName: 'Retatrutide', date, amount, unit: amount == null ? null : 'mg', doseText: null, takenAt,
})

/** 15 pre-dose nights from `start`, then `days` more with +3 bpm / -8 ms on days 1-2 after a dose. */
function nights(start: string, doseDates: string[], days: number, skip: Set<string> = new Set()): RecoveryNight[] {
  const first = doseDates[0]
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDateStr(start, i)
    if (skip.has(date)) return { date, restingHr: null, hrvMs: null }
    if (date < first) return { date, restingHr: BASE_RHR + wobble(i), hrvMs: BASE_HRV + wobble(i) }
    const last = [...doseDates].filter(d => d <= date).pop() as string
    const since = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000)
    const hit = since === 1 || since === 2
    return { date, restingHr: BASE_RHR + (hit ? 3 : 0), hrvMs: BASE_HRV - (hit ? 8 : 0) }
  })
}

// Four weekly 1 mg doses, 15 nights of baseline before the first.
const DOSE_DATES = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06']
const NIGHTS = nights('2026-08-01', DOSE_DATES, 42)
const DOSES = DOSE_DATES.map(d => dose(d, 1, `${d}T10:00:00Z`))

const ok = (r: MetricRecoveryResponse) => {
  if (r.state !== 'ok') throw new Error(`expected ok, got ${r.state}`)
  return r
}
const run = (doses = DOSES, ns = NIGHTS) => recoveryResponse({ doses, nights: ns, tz: TZ })

describe('recoveryResponse — a built-in response comes back out', () => {
  it('recovers +3 bpm and -8 ms on days 1-2, zero elsewhere, as deviations from the pre-dose median', () => {
    const [sub] = run()
    expect(sub.mixedDoseLevels).toBe(false)
    const rhr = ok(sub.levels[0].rhr)
    const hrv = ok(sub.levels[0].hrv)
    expect(rhr.cycles).toBe(4)
    expect(rhr.baseline).toMatchObject({ median: BASE_RHR, nights: 15, source: 'before_first_dose' })
    for (const o of rhr.offsets.slice(0, 6)) {
      expect(o.cycles).toBe(4)
      expect(o.median).toBe(o.offset === 1 || o.offset === 2 ? 3 : 0)
      // Every cycle shows the same response, so the spread is zero-width, not missing.
      expect(o.p25).toBe(o.median)
      expect(o.p75).toBe(o.median)
    }
    for (const o of hrv.offsets.slice(0, 6)) {
      expect(o.median).toBe(o.offset === 1 || o.offset === 2 ? -8 : 0)
    }
  })

  it('reports a spread when the cycles disagree', () => {
    // Cycle responses of +1, +3, +5, +7 on day 1: median +4, quartiles 2.5 and 5.5.
    const bumped = NIGHTS.map(n => {
      const idx = DOSE_DATES.findIndex(d => shiftDateStr(d, 1) === n.date)
      return idx < 0 ? n : { ...n, restingHr: BASE_RHR + 1 + 2 * idx }
    })
    const o = ok(run(DOSES, bumped)[0].levels[0].rhr).offsets[1]
    expect([o.median, o.p25, o.p75]).toEqual([4, 2.5, 5.5])
  })

  it('runs each cycle to the day before the next dose and no further', () => {
    const rhr = ok(run()[0].levels[0].rhr)
    // Weekly doses: offsets 0-6 are reached by all four cycles; the last cycle is open-ended but the
    // nights end on 2026-09-11, so nothing exists past offset 5 for it.
    expect(rhr.offsets.map(o => o.offset)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(rhr.offsets[6].cycles).toBe(3)
  })

  it('is deterministic, whatever order the inputs arrive in', () => {
    const a = run()
    const b = recoveryResponse({ doses: [...DOSES].reverse(), nights: [...NIGHTS].reverse(), tz: TZ })
    expect(b).toEqual(a)
    expect(run()).toEqual(a)
  })
})

describe('recoveryResponse — insufficient data is a state, not zeros', () => {
  it('is insufficient with a single cycle, and says how many it has', () => {
    const [sub] = run([DOSES[0]], nights('2026-08-01', [DOSE_DATES[0]], 22))
    expect(sub.levels[0].rhr).toEqual({ state: 'insufficient', cycles: 1, neededCycles: RECOVERY_MIN_CYCLES })
    expect(sub.levels[0].hrv.state).toBe('insufficient')
  })

  it('is insufficient with no nights at all, and with no doses there is no substance', () => {
    expect(run(DOSES, [])[0].levels[0].rhr.state).toBe('insufficient')
    expect(run([], NIGHTS)).toEqual([])
  })

  it('does not count a cycle with too few nights of readings', () => {
    // Keep two of the four cycles' windows down to two readings each: they cannot count.
    const thin = new Set<string>()
    for (const d of DOSE_DATES.slice(2)) {
      for (let k = RECOVERY_MIN_NIGHTS_PER_CYCLE - 1; k < 7; k++) thin.add(shiftDateStr(d, k))
    }
    const r = run(DOSES, nights('2026-08-01', DOSE_DATES, 42, thin))[0].levels[0].rhr
    expect(r.state).toBe('ok')
    expect(r.cycles).toBe(2)
    const none = new Set(DOSE_DATES.slice(1).flatMap(d => Array.from({ length: 7 }, (_, k) => shiftDateStr(d, k))))
    expect(run(DOSES, nights('2026-08-01', DOSE_DATES, 42, none))[0].levels[0].rhr.state).toBe('insufficient')
  })
})

describe('recoveryResponse — a missing night is a gap', () => {
  it('drops the night from that offset instead of counting it as zero', () => {
    const skip = new Set([shiftDateStr(DOSE_DATES[0], 1)])
    const o = ok(run(DOSES, nights('2026-08-01', DOSE_DATES, 42, skip))[0].levels[0].rhr).offsets[1]
    expect(o.cycles).toBe(3)
    // A 0 deviation sneaking in for the gap would drag the median below 3.
    expect(o.median).toBe(3)
  })

  it('reports a null centre, not 0, where fewer cycles than the floor reached an offset', () => {
    const skip = new Set(DOSE_DATES.slice(0, 3).map(d => shiftDateStr(d, 1)))
    const o = ok(run(DOSES, nights('2026-08-01', DOSE_DATES, 42, skip))[0].levels[0].rhr).offsets[1]
    expect(o).toEqual({ offset: 1, cycles: 1, median: null, p25: null, p75: null })
  })

  it('treats a null reading in one metric as a gap in that metric only', () => {
    const ns = NIGHTS.map(n => (n.date === shiftDateStr(DOSE_DATES[1], 1) ? { ...n, hrvMs: null } : n))
    const level = run(DOSES, ns)[0].levels[0]
    expect(ok(level.hrv).offsets[1].cycles).toBe(3)
    expect(ok(level.rhr).offsets[1].cycles).toBe(4)
  })
})

describe('recoveryResponse — dose with no time, and the day it belongs to', () => {
  it('counts an untimed dose by log_date and says so', () => {
    const untimed = DOSE_DATES.map((d, i) => dose(d, 1, i === 0 ? null : `${d}T10:00:00Z`))
    const level = run(untimed)[0].levels[0]
    expect(level.doses).toBe(4)
    expect(level.timedDoses).toBe(3)
    expect(level.untimedDoses).toBe(1)
    // Day-level alignment for every dose: the response is identical to the all-timed run.
    expect(level.rhr).toEqual(run()[0].levels[0].rhr)
  })

  it('keeps the log_date as the dose day when taken_at falls on the next local day', () => {
    // 14:30Z is 00:30 the NEXT day in Brisbane (UTC+10); the log was written with the earlier day.
    const edge = DOSE_DATES.map((d, i) => dose(d, 1, i === 1 ? `${d}T14:30:00Z` : `${d}T13:30:00Z`))
    const level = run(edge)[0].levels[0]
    expect(level.timeDayDisagrees).toBe(1)
    expect(level.rhr).toEqual(run()[0].levels[0].rhr)
  })
})

describe('recoveryResponse — never pooled across a dose change', () => {
  it('splits 0.5 mg from 1 mg and flags the mix (the owner\'s first three doses)', () => {
    const real = [dose('2026-09-07', 0.5), dose('2026-09-13', 1), dose('2026-09-20', 1)]
    const [sub] = run(real, nights('2026-08-20', ['2026-09-07', '2026-09-13', '2026-09-20'], 40))
    expect(sub.mixedDoseLevels).toBe(true)
    expect(sub.levels.map(l => [l.amount, l.unit, l.doses])).toEqual([[0.5, 'mg', 1], [1, 'mg', 2]])
    // The titration step is a single cycle: it must not borrow the 1 mg cycles to reach two.
    expect(sub.levels[0].rhr).toEqual({ state: 'insufficient', cycles: 1, neededCycles: 2 })
    expect(sub.levels[1].rhr.state).toBe('ok')
    expect(ok(sub.levels[1].rhr).cycles).toBe(2)
  })

  it('treats the same amount in a different unit as a change, and an unlogged amount as its own group', () => {
    const mixed = [dose('2026-08-16', 1), { ...dose('2026-08-23', 1), unit: 'mL' }, dose('2026-08-30', null)]
    const [sub] = run(mixed)
    expect(sub.levels).toHaveLength(3)
    expect(sub.levels[2].amount).toBeNull()
  })

  it('keeps substances apart', () => {
    const other: RecoveryDose = { ...dose('2026-08-20', 2), supplementId: 'sub-other', supplementName: 'Other' }
    const out = run([...DOSES, other])
    expect(out.map(s => s.supplementName)).toEqual(['Other', 'Retatrutide'])
  })
})

describe('recoveryResponse — the baseline', () => {
  it('uses only nights before the first dose when there are enough, so a cycle never judges itself', () => {
    const louder = NIGHTS.map(n => (n.date >= DOSE_DATES[0] ? { ...n, restingHr: 99 } : n))
    const rhr = ok(run(DOSES, louder)[0].levels[0].rhr)
    expect(rhr.baseline.median).toBe(BASE_RHR)
    expect(rhr.baseline.source).toBe('before_first_dose')
    expect(rhr.baseline.iqr).toBe(2)
  })

  it('falls back to all nights, marked, when too few pre-dose nights exist', () => {
    const short = NIGHTS.filter(n => n.date >= '2026-08-13')
    const rhr = ok(run(DOSES, short)[0].levels[0].rhr)
    expect(rhr.baseline.source).toBe('all_nights')
    expect(rhr.baseline.nights).toBe(short.length)
  })
})

describe('recoveryResponse — output carries no claim', () => {
  it('returns numbers and states only: the only strings are ids, names, units and fixed state tags', () => {
    const text: string[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'string') text.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(run())
    expect(new Set(text)).toEqual(new Set([SUBSTANCE, 'Retatrutide', 'mg', 'ok', 'before_first_dose']))
  })
})
