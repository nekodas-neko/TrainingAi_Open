import { isPreRekey } from '@/lib/oura/cloud-freshness'
import type { OuraDailyDerivedRow, OuraDailyRow, WorkoutRepository } from '@/lib/data/repository'

// The live composite readiness — One Formula, One Place. Since the 2026-07-07 ring re-key the
// Oura Cloud gets no new data, so `oura_daily.readiness_score` is frozen; the app's own composite
// is persisted to `oura_daily_derived.readiness_score` (source 'ble-derived'). Every AI surface
// (prescribe signals, chat, weekly digest, health insight, next-session deload) must read readiness
// through here so it never narrates a stale pre-re-key Cloud number the Health screen contradicts.

type DerivedReadiness = Pick<OuraDailyDerivedRow, 'day' | 'readinessScore' | 'readinessSource'>
type CloudReadiness = Pick<OuraDailyRow, 'date' | 'readinessScore'>

/** Live readiness per day: the own BLE-derived composite when present; else the frozen Cloud value
 *  ONLY for pre-re-key days (when it was still a real reading); else absent. Pure — callers pass the
 *  rows they already fetched. */
export function liveReadinessByDay(derived: DerivedReadiness[], cloud: CloudReadiness[] = []): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of derived) {
    if (d.readinessSource === 'ble-derived' && d.readinessScore != null) out.set(d.day, d.readinessScore)
  }
  // Pre-re-key Cloud only fills days the composite doesn't cover (post-re-key Cloud is frozen).
  for (const c of cloud) {
    if (c.readinessScore != null && isPreRekey(c.date) && !out.has(c.date)) out.set(c.date, c.readinessScore)
  }
  return out
}

/** Live readiness for a single day, or null. */
export function liveReadinessForDay(day: string, derived: DerivedReadiness[], cloud: CloudReadiness[] = []): number | null {
  return liveReadinessByDay(derived, cloud).get(day) ?? null
}

/** Repo-backed accessor for callers that haven't already fetched the rows. */
export async function getLiveReadiness(repo: WorkoutRepository, userId: string, day: string): Promise<number | null> {
  const [derived, cloud] = await Promise.all([
    repo.getOuraDailyDerived(userId, day, day),
    isPreRekey(day) ? repo.getOuraDaily(userId, day, day) : Promise.resolve([]),
  ])
  return liveReadinessForDay(day, derived, cloud)
}
