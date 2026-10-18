import type { OuraDailyDerivedRow, WorkoutRepository } from '@/lib/data/repository'

// The live composite readiness — One Formula, One Place. The app's own composite is persisted to
// `oura_daily_derived.readiness_score`. Every AI surface (prescribe signals, chat, weekly digest,
// health insight, next-session deload) must read readiness through here.
//
// #2992: it is OUR composite whatever device fed it. Where each input came from lives on the
// contributors (`source`, since #2984), not on the row, so both row labels count:
// `ble-derived` (a ring summary was in the window) and `generic-derived` (it was not — Health
// Connect, manual, and every Oura Cloud day once the last ring row leaves the window).
//
// Oura's own readiness (`oura_daily.readiness_score`) is never read here, pre-re-key or not: it is
// the tuning reference, not our readiness (owner's rule 1 on #2860).

type DerivedReadiness = Pick<OuraDailyDerivedRow, 'day' | 'readinessScore' | 'readinessSource'>

/** The `readiness_source` labels the app's own composite writes. Anything else is not ours. */
export const OWN_READINESS_SOURCES: ReadonlySet<string> = new Set(['ble-derived', 'generic-derived'])

/** True when a derived row's readiness is the app's own composite. */
export function isOwnReadinessSource(source: string | null | undefined): boolean {
  return source != null && OWN_READINESS_SOURCES.has(source)
}

/** Live readiness per day: the app's own composite where one was stored, else absent. Pure. */
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

/** Repo-backed accessor for callers that haven't already fetched the rows. */
export async function getLiveReadiness(repo: WorkoutRepository, userId: string, day: string): Promise<number | null> {
  return liveReadinessForDay(day, await repo.getOuraDailyDerived(userId, day, day))
}
