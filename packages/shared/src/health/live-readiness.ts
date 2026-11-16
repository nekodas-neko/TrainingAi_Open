import type { OuraDailyDerivedRow } from '@/lib/data/repository'
import { toCurrentReadinessScale } from './readiness-scale'
import { readinessModelVersionOf } from './readiness-decision-thresholds'

// The live composite readiness — One Formula, One Place. The app's own composite is persisted to
// `oura_daily_derived.readiness_score` (`OWN_READINESS_SOURCES` below). Every AI surface (prescribe signals,
// chat, weekly digest, health insight, next-session deload) must read readiness through here.
//
// Oura's own readiness (`oura_daily.readiness_score`) is never ours, for any day (scoring doc
// rule 5, #3000). It used to stand in for days on or before the 2026-07-07 re-key; since the Oura
// Cloud connector writes it again (15 Oct) that arm would have narrated Oura's number as ours.

type DerivedReadiness = Pick<OuraDailyDerivedRow, 'day' | 'readinessScore' | 'readinessSource'>

/**
 * #2992: the `readiness_source` labels the app's own composite writes. Both are ours whatever device
 * fed the inputs; where each input came from lives on the contributors (`source`, since #2984).
 * `generic-derived` is every Oura Cloud day once no ring summary is in the window. Anything else is
 * not our composite and stays excluded.
 */
export const OWN_READINESS_SOURCES: ReadonlySet<string> = new Set(['ble-derived', 'generic-derived'])

/** True when a derived row's readiness is the app's own composite. */
export function isOwnReadinessSource(source: string | null | undefined): boolean {
  return source != null && OWN_READINESS_SOURCES.has(source)
}

/** Live readiness per day: our own composite when present, else absent. Pure — callers
 *  pass the rows they already fetched. */
export function liveReadinessByDay(derived: DerivedReadiness[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of derived) {
    if (isOwnReadinessSource(d.readinessSource) && d.readinessScore != null) out.set(d.day, d.readinessScore)
  }
  return out
}

/** Live readiness for a single day, or null. */
export function liveReadinessForDay(day: string, derived: DerivedReadiness[]): number | null {
  return liveReadinessByDay(derived).get(day) ?? null
}

type DerivedReadinessWithModel = DerivedReadiness & Pick<OuraDailyDerivedRow, 'modelVersions'>

/** A day's live readiness with the model version that scored it, so a decision cut can be chosen
 *  for the scale the score is on (`cutFor`, #3824). Null when the day has none. */
export interface LiveReadinessReading {
  score: number
  /** `model_versions.readiness` on the row; null on rows written before the stamp existed. */
  modelVersion: string | null
}

/** {@link liveReadinessForDay} with the row's model version beside the score. */
export function liveReadinessReadingForDay(day: string, derived: DerivedReadinessWithModel[]): LiveReadinessReading | null {
  const row = derived.find(d => d.day === day && isOwnReadinessSource(d.readinessSource) && d.readinessScore != null)
  if (!row) return null
  return { score: row.readinessScore!, modelVersion: readinessModelVersionOf(row.modelVersions) }
}

/**
 * Live readiness per day, every day on the CURRENT scale (#3824), for anything that averages or
 * differences readiness across days. A pre-v18 day is converted by `toCurrentReadinessScale`; one
 * whose row has no contributor map cannot be, and is left out rather than mixed in.
 */
export function liveReadinessByDayOnCurrentScale(
  derived: (DerivedReadinessWithModel & Pick<OuraDailyDerivedRow, 'readinessContributors'>)[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of derived) {
    if (!isOwnReadinessSource(d.readinessSource)) continue
    const v = toCurrentReadinessScale(d.readinessScore, readinessModelVersionOf(d.modelVersions), d.readinessContributors)
    if (v != null) out.set(d.day, v)
  }
  return out
}
