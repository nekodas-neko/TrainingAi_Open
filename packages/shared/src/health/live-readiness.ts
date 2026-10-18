import type { OuraDailyDerivedRow, WorkoutRepository } from '@/lib/data/repository'

// The live composite readiness — One Formula, One Place. The app's own composite is persisted to
// `oura_daily_derived.readiness_score` (source 'ble-derived'). Every AI surface (prescribe signals,
// chat, weekly digest, health insight, next-session deload) must read readiness through here.
//
// Oura's own readiness (`oura_daily.readiness_score`) is never ours, for any day (scoring doc
// rule 5, #3000). It used to stand in for days on or before the 2026-07-07 re-key; since the Oura
// Cloud connector writes it again (15 Oct) that arm would have narrated Oura's number as ours.

type DerivedReadiness = Pick<OuraDailyDerivedRow, 'day' | 'readinessScore' | 'readinessSource'>

/** Live readiness per day: the own BLE-derived composite when present, else absent. Pure — callers
 *  pass the rows they already fetched. */
export function liveReadinessByDay(derived: DerivedReadiness[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of derived) {
    if (d.readinessSource === 'ble-derived' && d.readinessScore != null) out.set(d.day, d.readinessScore)
  }
  return out
}

/** Live readiness for a single day, or null. */
export function liveReadinessForDay(day: string, derived: DerivedReadiness[]): number | null {
  return liveReadinessByDay(derived).get(day) ?? null
}

/** Repo-backed accessor for callers that haven't already fetched the rows. */
export async function getLiveReadiness(repo: WorkoutRepository, userId: string, day: string): Promise<number | null> {
  return liveReadinessForDay(day, await repo.getOuraDailyDerived(userId, day, day))
}
