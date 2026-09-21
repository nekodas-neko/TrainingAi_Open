import type { WorkoutRepository } from '@/lib/data/repository'
import { todayInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { hrMaxFromAge } from '@trainingai/shared/health/hr-zones'
import { computeObservedHr, resolveMaxHr, type ObservedHrProfile } from '@trainingai/shared/health/observed-hr'

/** Trailing window the observed max/min is corroborated over. */
export const OBSERVED_WINDOW_DAYS = 90

export interface HrProfile {
  /**
   * The ceiling for %-of-max effort math. Conservative: the observed max is used only when
   * it is reliable AND at least the age-predicted value, because a low observed max usually
   * means you haven't gone hard on a monitored session lately — that must not drag the
   * ceiling down and make ordinary efforts read as maximal.
   */
  maxHr: number
  /**
   * The anchor for *reachable* targets (guided-walk blocks, fitness-test protocols): the
   * corroborated observed max when there is one, else age-predicted.
   *
   * Deliberately a different number from `maxHr`, and that is the whole subtlety here.
   * 220−age reads as a 20-year-old athlete's ceiling, so anchoring walk targets on it puts
   * the fast block out of reach without jogging. But anchoring the *ceiling* on a low
   * observed max would make every hard effort read as >100%. One resolver, two
   * explicitly-named answers — rather than the three accidental ones this replaces.
   */
  targetAnchorMax: number
  restingHr: number
  /** `'default'` means no reading was found in the window and 60 was assumed — every zone
   *  boundary derived from it is a guess, so callers can say so instead of implying data. */
  restingHrSource: 'measured' | 'default'
  /** Age-predicted (220 − age), before any observation is considered. */
  estimatedMax: number
  /** Corroborated observed max — null until the profile is reliable. */
  observedMax: number | null
  maxHrSource: 'observed' | 'estimated'
  /** The full spike-rejection detail, for surfaces that want to show their working. */
  observed: ObservedHrProfile
}

const RESTING_HR_WINDOW_DAYS = 28
const RESTING_HR_DEFAULT = 60

/**
 * The canonical HR profile — the single resolver for max HR, target anchor and resting HR.
 *
 * This replaces three resolvers that disagreed: `hrMaxFromAge` (age only), `resolveMaxHr`
 * (observed only if ≥ age-predicted) and `estimateHrMax` (observed always, *ungated*). They
 * agreed only by accident — the observed max sat below the age prediction, masking the
 * divergence; the first reading above it would have split them silently.
 *
 * Every observed value now comes from `computeObservedHr`, so a stray spike can never move
 * the max: readings outside 30–220 bpm are dropped as sensor errors, and the max is the
 * k-th highest reading rather than the highest, so several corroborating readings are
 * needed to move it. Before this, two producers took a bare `Math.max` over raw readings
 * and one of them persisted the result, making a single artefact a permanent ceiling.
 *
 * Resting HR is averaged over a FIXED 28-day window, deliberately not the caller's query
 * range — deriving it from a caller-controlled window shifts the zone boundaries with the
 * range and bakes the shifting bands into the `daily_zone_minutes` cache (review J-2).
 */
export async function resolveHrProfile(repo: WorkoutRepository, userId: string, tz: string): Promise<HrProfile> {
  return (await resolveHrProfileWithWindow(repo, userId, tz)).profile
}

/**
 * The same resolver, also handing back the HR rows it already fetched and the window they cover.
 *
 * RV-73 — `/api/cardio-week` needs order statistics over a rolling 30-day window and the 30 days
 * before it, and was issuing two more `getHrForWindow` calls for them. Both windows are **wholly
 * contained** in the 90 days this resolver has already pulled, so the rows were being fetched,
 * materialised and thrown away twice over: a second and third pass of the heaviest query in the app
 * for data already in memory.
 *
 * The rows are returned from a SEPARATE export rather than added to `HrProfile`, deliberately.
 * `/api/hr-profile` serialises that interface straight into its response and ten other call sites
 * read it — putting a 130,000-row array on it would ship the whole window to the client.
 *
 * **Slicing this is equivalent to re-querying, with one boundary caveat worth stating rather than
 * discovering.** `getHrForWindow` applies `preferStrapBuckets`, which drops a ring row when a chest
 * strap row shares its 10-second bucket. Merging over 90 days and then cutting can therefore drop a
 * ring row whose bucket-mate sits just outside the caller's window, where a fresh 30-day query
 * would have kept it — at most the rows in the single bucket straddling each boundary, and always
 * in the direction of dropping a ring reading the strap already covered. Measured against
 * production on 2026-09-21 over the owner's current 30-day window, both paths return **57,998 rows,
 * mean 86, k-th highest 175, k-th lowest 37** — identical.
 */
export async function resolveHrProfileWithWindow(
  repo: WorkoutRepository, userId: string, tz: string,
): Promise<{ profile: HrProfile; hrRows: { timestamp: Date; bpm: number; source: string | null }[]; from: Date; to: Date }> {
  const todayIso = todayInTz(tz)
  const midnight = todayMidnightUtc(tz)
  const from28dIso = toAestDay(new Date(midnight.getTime() - RESTING_HR_WINDOW_DAYS * 86_400_000), tz)
  const observedFrom = new Date(midnight.getTime() - OBSERVED_WINDOW_DAYS * 86_400_000)

  const observedTo = new Date()

  const [user, bodyMetrics, hrRows] = await Promise.all([
    repo.getUserById(userId),
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.getHrForWindow(userId, observedFrom, observedTo).catch(() => []),
  ])

  const rhrRows = bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const restingHr = rhrRows.length
    ? Math.round(rhrRows.reduce((sum, m) => sum + m.restingHeartRate!, 0) / rhrRows.length)
    : RESTING_HR_DEFAULT

  const estimatedMax = hrMaxFromAge(ageFromDob(user?.dateOfBirth, new Date()))
  const observed = computeObservedHr(hrRows.map(r => r.bpm))
  const resolved = resolveMaxHr(observed, estimatedMax)
  const observedMax = observed.isReliable ? observed.max : null

  return {
    profile: {
      maxHr: resolved.maxUsed,
      targetAnchorMax: observedMax ?? estimatedMax,
      restingHr,
      restingHrSource: rhrRows.length ? 'measured' : 'default',
      estimatedMax,
      observedMax,
      maxHrSource: resolved.source,
      observed,
    },
    hrRows,
    from: observedFrom,
    to: observedTo,
  }
}
