import type { SleepComponent, SleepVerdict } from '@trainingai/shared/health/sleep-verdict'

/** The verdict as `/api/sleep-verdict` returns it — the stored snapshot, never recomputed. */
export interface StoredSleepVerdict {
  date: string
  verdict: SleepVerdict
  triggered: SleepComponent[]
  components: {
    durationHours: number | null
    onsetMinutes: number | null
    efficiency: number | null
  }
  bands: {
    durationLow: number | null
    durationHigh: number | null
    onsetLow: number | null
    onsetHigh: number | null
    efficiencyLow: number | null
    efficiencyHigh: number | null
  }
  baselineNights: number
  modelVersion: number
  responseState: 'none' | 'acknowledged' | 'corrected'
}

/** `5.17` → `5h10`. Hours and minutes, never a decimal — nobody reads their night as 5.2 hours. */
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/**
 * Signed minutes from local midnight → a clock time. `-50` → `11:10pm`, `80` → `1:20am`.
 *
 * The sign is what makes this arithmetic instead of modular wrapping — see `VerdictNight.onsetMinutes`.
 * Device-local formatting is not used anywhere here: these minutes are already in the user's zone,
 * so turning them back into a `Date` would be the timezone bug this app keeps re-finding.
 */
export function formatClock(minutesFromMidnight: number): string {
  const wrapped = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440
  const hour24 = Math.floor(wrapped / 60)
  const minute = wrapped % 60
  const suffix = hour24 < 12 ? 'am' : 'pm'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${String(minute).padStart(2, '0')}${suffix}`
}

/**
 * One clause of evidence per component that fired, in the snapshot's own numbers.
 *
 * **Each clause states the VALUE and how far outside it fell**, because the verdict is only
 * arguable if its evidence is visible — "your sleep was bad" invites being ignored, "5h10, 1h20
 * short of your usual" invites either a nod or a correction. That is the plan's whole instrument.
 *
 * **The distance is measured from the BAND EDGE, not from a median, and that is a constraint
 * rather than a preference:** `sleep_verdicts` snapshots `*_low`/`*_high` and drops
 * `ComponentBand.median`, so "90 minutes later than usual" cannot be said from a stored row
 * without re-deriving a middle the verdict never saw. "Your usual" therefore means *your usual
 * range*, and the distance quoted is to the edge of it — the smallest true claim, and the one the
 * verdict actually acted on.
 *
 * Returns `null` rather than half a sentence when the snapshot has no value or no band for the
 * component: coverage differs per component, so a band can exist for duration and not efficiency.
 */
export function componentClause(v: StoredSleepVerdict, component: SleepComponent): string | null {
  const value = componentValue(v, component)
  const delta = componentDelta(v, component)
  return value && delta ? `${value}, ${delta}` : null
}

/** The night's own number: `slept 5h10`, `asleep at 1:20am`, `82% of the night asleep`. */
export function componentValue(v: StoredSleepVerdict, component: SleepComponent): string | null {
  const { components: c, bands: b } = v
  if (component === 'duration') {
    return c.durationHours == null || b.durationLow == null || b.durationHigh == null
      ? null : `slept ${formatDuration(c.durationHours)}`
  }
  if (component === 'onset') {
    return c.onsetMinutes == null || b.onsetLow == null || b.onsetHigh == null
      ? null : `asleep at ${formatClock(c.onsetMinutes)}`
  }
  return c.efficiency == null || b.efficiencyLow == null || b.efficiencyHigh == null
    ? null : `${Math.round(c.efficiency)}% of the night asleep`
}

/** How far outside the band it fell, in the direction it fell. */
export function componentDelta(v: StoredSleepVerdict, component: SleepComponent): string | null {
  const { components: c, bands: b } = v
  if (component === 'duration') {
    if (c.durationHours == null || b.durationLow == null || b.durationHigh == null) return null
    const over = c.durationHours > b.durationHigh
    const delta = over ? c.durationHours - b.durationHigh : b.durationLow - c.durationHours
    return `${formatDuration(delta)} ${over ? 'over' : 'short of'} your usual`
  }
  if (component === 'onset') {
    if (c.onsetMinutes == null || b.onsetLow == null || b.onsetHigh == null) return null
    const late = c.onsetMinutes > b.onsetHigh
    const delta = Math.round(late ? c.onsetMinutes - b.onsetHigh : b.onsetLow - c.onsetMinutes)
    return `${delta} min ${late ? 'later' : 'earlier'} than usual`
  }
  if (c.efficiency == null || b.efficiencyLow == null || b.efficiencyHigh == null) return null
  const over = c.efficiency > b.efficiencyHigh
  const delta = Math.round(over ? c.efficiency - b.efficiencyHigh : b.efficiencyLow - c.efficiency)
  return `${delta} points ${over ? 'above' : 'below'} your usual`
}

export interface VerdictCopy {
  /** The sentence to show. Never a question — asking is the intervention that failed three times. */
  line: string
  /** Whether to draw it prominently. `false` is the quiet ordinary day. */
  prominent: boolean
}

const CAPITALISE = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What the app says about last night (TN-82's copy, TN-84's wording).
 *
 * **The numbers come before the verdict**, deliberately: a verdict with no stated cause cannot be
 * argued with, and argument is the only thing this collects. There is no question mark anywhere —
 * three in-sheet questions have already decayed to zero on this owner's surfaces.
 *
 * A `normal` night is announced too, and that is not decoration: under an outliers-only design the
 * error that matters most — a night marked normal that he would have called bad — produces no
 * announcement and is invisible by construction.
 */
export function verdictCopy(v: StoredSleepVerdict): VerdictCopy {
  if (v.verdict === 'normal') {
    return { line: 'Sleep looks normal — filled in for you.', prominent: false }
  }
  // **The first fact carries the night's own number; the rest carry only the distance.** Two full
  // clauses ran to three lines on the S25 at 412 px, and a three-line announcement is the failure
  // mode this whole design is built around — the sleep screen has the rest. One clause alone gets
  // its distance too, since there is room for it and the distance is what makes it arguable.
  const parts = v.triggered
    .map(component => ({ component, value: componentValue(v, component), delta: componentDelta(v, component) }))
    .filter(p => p.value != null && p.delta != null)
    .slice(0, 2)
  const clauses = parts.length === 1
    ? [`${parts[0].value}, ${parts[0].delta}`]
    // A follow-on clause is the distance alone — except efficiency, whose "6 points below your
    // usual" names no quantity a reader can place without the percentage in front of it.
    : parts.map((p, i) => (i === 0 || p.component === 'efficiency' ? `${p.value}${i === 0 ? '' : `, ${p.delta}`}` : p.delta!))
  const word = v.verdict === 'poor' ? 'poor' : 'good'
  const evidence = clauses.length > 0 ? `${CAPITALISE(clauses.join(', '))}. ` : ''
  return { line: `${evidence}Marked this a ${word} night.`, prominent: true }
}
