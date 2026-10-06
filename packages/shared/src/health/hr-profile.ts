import type { WorkoutRepository } from '@/lib/data/repository'
import { todayInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { hrMaxFromAge, DEFAULT_RESTING_HR } from '@trainingai/shared/health/hr-zones'
import { resolveMaxHr, EMPTY_OBSERVED_HR, type ObservedHrProfile } from '@trainingai/shared/health/observed-hr'

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
   *  boundary derived from it is a guess, so callers can say so instead of implying data.
   *  `'unavailable'` means the read itself FAILED and 60 was assumed (LA-82) — not "you have no
   *  readings", which is a different thing to tell someone. */
  restingHrSource: 'measured' | 'default' | 'unavailable'
  /** Age-predicted (220 − age), before any observation is considered. */
  estimatedMax: number
  /** Corroborated observed max — null until the profile is reliable. */
  observedMax: number | null
  /** `'estimated-age-unread'` (LA-82): the estimate stands in for an age that could not be READ,
   *  so it is `hrMaxFromAge(null)` — 190 — not this person's 220 − age. For the owner that moves
   *  every zone boundary by 6 bpm, and without its own value it would read exactly like an ordinary
   *  estimate. A provenance value rather than a separate flag, so there is one field to trust. */
  maxHrSource: 'observed' | 'estimated' | 'estimated-age-unread'
  /** The full spike-rejection detail, for surfaces that want to show their working. */
  observed: ObservedHrProfile
}

const RESTING_HR_WINDOW_DAYS = 28


/**
 * The canonical HR profile — the single resolver for max HR, target anchor and resting HR.
 *
 * This replaces three resolvers that disagreed: `hrMaxFromAge` (age only), `resolveMaxHr`
 * (observed only if >= age-predicted) and `estimateHrMax` (observed always, *ungated*). They
 * agreed only by accident — the observed max sat below the age prediction, masking the
 * divergence; the first reading above it would have split them silently.
 *
 * Every observed value comes from the corroboration rules in `observed-hr.ts`, so a stray spike
 * can never move the max: readings outside 30-220 bpm are dropped as sensor errors, and the max
 * is the k-th highest reading rather than the highest, so several corroborating readings are
 * needed to move it. Before this, two producers took a bare `Math.max` over raw readings and one
 * of them persisted the result, making a single artefact a permanent ceiling.
 *
 * **Those rules now run in SQL, not here** (RV-181). `repo.getObservedHrProfile` returns one row
 * where this used to pull the whole 90-day window — 133,041 rows after the strap merge, on the
 * query that was 51% of all database time. `getObservedHrProfile`'s own comment carries the
 * measurements and the equivalence argument; `observed-hr-sql-equivalence.test.ts` holds the two
 * paths to the same answer.
 *
 * Resting HR is averaged over a FIXED 28-day window, deliberately not the caller's query
 * range — deriving it from a caller-controlled window shifts the zone boundaries with the
 * range and bakes the shifting bands into the `daily_zone_minutes` cache (review J-2).
 *
 * **`resolveHrProfileWithWindow` is gone with the row fetch.** It existed so `/api/cardio-week`
 * could slice its two 30-day windows out of the 90 days this resolver had already pulled (RV-73),
 * and carried a boundary caveat because slicing a merged 90-day set is not quite the same as
 * merging each window. With no rows to share, that route queries each window directly and the
 * caveat goes with it.
 */
export async function resolveHrProfile(repo: WorkoutRepository, userId: string, tz: string): Promise<HrProfile> {
  const todayIso = todayInTz(tz)
  const midnight = todayMidnightUtc(tz)
  const from28dIso = toAestDay(new Date(midnight.getTime() - RESTING_HR_WINDOW_DAYS * 86_400_000), tz)
  const observedFrom = new Date(midnight.getTime() - OBSERVED_WINDOW_DAYS * 86_400_000)
  const observedTo = new Date()

  // LA-82. All three reads are guarded now, not one of three. Every caller of this resolver — the
  // cardio hub among them — is built to degrade on missing data, and an unguarded read made a
  // transient fault in either of these two take the whole screen down instead. What a guard must
  // not do is make a failure look like data, so each failed read is named in its source field.
  const unread = new Set<'user' | 'restingHr'>()
  const failed = (what: 'user' | 'restingHr') => (err: unknown) => {
    console.error(`[hr-profile] ${what} read failed, continuing on a default:`, err)
    unread.add(what)
    return null
  }
  const [user, bodyMetrics, observed] = await Promise.all([
    repo.getUserById(userId).catch(failed('user')),
    repo.listBodyMetrics(userId, from28dIso, todayIso).catch(failed('restingHr')),
    repo.getObservedHrProfile(userId, observedFrom, observedTo).catch(() => EMPTY_OBSERVED_HR),
  ])

  const rhrRows = (bodyMetrics ?? []).filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const restingHr = rhrRows.length
    ? Math.round(rhrRows.reduce((sum, m) => sum + m.restingHeartRate!, 0) / rhrRows.length)
    : DEFAULT_RESTING_HR

  const estimatedMax = hrMaxFromAge(ageFromDob(user?.dateOfBirth, new Date()))
  const resolved = resolveMaxHr(observed, estimatedMax)
  const observedMax = observed.isReliable ? observed.max : null

  return {
    maxHr: resolved.maxUsed,
    targetAnchorMax: observedMax ?? estimatedMax,
    restingHr,
    restingHrSource: unread.has('restingHr') ? 'unavailable' : rhrRows.length ? 'measured' : 'default',
    estimatedMax,
    observedMax,
    maxHrSource: resolved.source === 'estimated' && unread.has('user') ? 'estimated-age-unread' : resolved.source,
    observed,
  }
}
