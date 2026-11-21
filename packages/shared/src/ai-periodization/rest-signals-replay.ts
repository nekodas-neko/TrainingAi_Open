// #3718 — the count the owner signs off before the daily check's three new rest signals ship: over
// past days, how often each would have suggested rest, how often the check already suggested rest
// for another reason, and how often a workout was done anyway. Counts only: no value, date or name
// leaves this function. `scripts/tuning/rest-signals-replay.cjs` feeds it the stored days.
import { decideDailyRest, freshRatio, REST_SIGNAL_KINDS, type DailyRestInput, type RestSignalKind } from './daily-rest-decision'

export interface ReplayDay {
  /** The morning's inputs, as the daily check would have read them that day. */
  input: DailyRestInput
  /** A workout with at least one logged exercise was done that day. */
  trained: boolean
}

export interface SignalCount {
  /** Days this signal would have flagged. */
  flagged: number
  /** …of which the check already suggested rest (any grade) for another reason. */
  alreadySuggested: number
  /** …of which the earlier suggestion was more than the soft "consider a rest soon" nudge. */
  alreadySuggestedNotSoft: number
  /** …of which a workout was done. */
  trained: number
}

export interface RestSignalReplaySummary {
  days: number
  /** Days with each signal's inputs present and fresh, so it could have fired at all. */
  evaluable: Record<RestSignalKind, number>
  bySignal: Record<RestSignalKind, SignalCount>
  /** Days at least one signal could have fired. */
  evaluableAny: number
  /** Days any new signal fired. */
  anySignal: SignalCount
  /** Days the suggestion is new: a signal fired and nothing else suggested rest. */
  newlySuggested: number
  /** Days the grade rises (none → a grade, or soft → recommended → strong). */
  gradeRaised: number
}

const RANK = { none: -1, soft: 0, recommended: 1, strong: 2 } as const

function evaluable(input: DailyRestInput): Record<RestSignalKind, boolean> {
  const fresh = (t: DailyRestInput['hrvTrend']) => freshRatio(t, input.today) != null
  return {
    readinessVeryLow: input.readinessScore != null,
    sleepAndHrvLow: fresh(input.sleepTrend) && fresh(input.hrvTrend),
    spo2Low: fresh(input.spo2Trend),
  }
}

const zero = (): SignalCount => ({ flagged: 0, alreadySuggested: 0, alreadySuggestedNotSoft: 0, trained: 0 })

export function summariseRestSignalReplay(days: readonly ReplayDay[]): RestSignalReplaySummary {
  const bySignal = Object.fromEntries(REST_SIGNAL_KINDS.map(k => [k, zero()])) as Record<RestSignalKind, SignalCount>
  const ev = Object.fromEntries(REST_SIGNAL_KINDS.map(k => [k, 0])) as Record<RestSignalKind, number>
  const anySignal = zero()
  let newlySuggested = 0
  let evaluableAny = 0
  let gradeRaised = 0
  const tally = (c: SignalCount, before: ReturnType<typeof decideDailyRest>, trained: boolean) => {
    c.flagged++
    if (before.recommended) c.alreadySuggested++
    if (before.recommended && before.strength !== 'soft') c.alreadySuggestedNotSoft++
    if (trained) c.trained++
  }
  for (const day of days) {
    const after = decideDailyRest(day.input)
    const before = decideDailyRest(day.input, { withRestSignals: false })
    const e = evaluable(day.input)
    for (const k of REST_SIGNAL_KINDS) if (e[k]) ev[k]++
    if (REST_SIGNAL_KINDS.some(k => e[k])) evaluableAny++
    for (const k of after.restSignals) tally(bySignal[k], before, day.trained)
    if (after.restSignals.length > 0) {
      tally(anySignal, before, day.trained)
      if (!before.recommended) newlySuggested++
    }
    const rank = (d: typeof after) => d.recommended ? RANK[d.strength] : RANK.none
    if (rank(after) > rank(before)) gradeRaised++
  }
  return { days: days.length, evaluable: ev, evaluableAny, bySignal, anySignal, newlySuggested, gradeRaised }
}
