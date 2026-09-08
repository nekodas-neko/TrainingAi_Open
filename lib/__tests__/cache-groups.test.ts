import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))

import {
  invalidateWorkoutSummaries, invalidateReadinessInputs, invalidateProgramStructure,
  invalidateGoalRecommendations, invalidateOuraSync, invalidateInjuryWrites,
  invalidateActivityWrites, invalidateBodyMetricWrite, invalidateFriends,
  invalidateSupplements, invalidateHealthTrends, invalidateNutritionWrite,
  invalidateExerciseLogged, invalidateMealTypes, invalidateUserProfile,
  invalidateAiPeriodization, invalidateExerciseLibrary,
  invalidateActivityTypes, invalidateAdminPendingCount, invalidateBiometrics,
  invalidatePrescriptionChanged, invalidateCheckinAffectsPrescription,
} from '../cache-groups'

beforeEach(() => { invalidated.length = 0 })

describe('cache group helpers', () => {
  it('invalidateWorkoutSummaries clears all derived workout caches including the achievements prefix', async () => {
    await invalidateWorkoutSummaries()
    expect(invalidated).toEqual(expect.arrayContaining([
      'weekly-stats', 'weights-summary', 'next-session',
      'muscle-recovery', 'readiness-score', 'achievements:', 'progress-summary',
      'friends-leaderboard', 'exercise-history:', 'program-week', 'health-trends:',
      'workout-card:', 'health-trends-summary', 'muscle-tonnage-trend', 'workout-load-history:',
      // done-screen per-session payloads + the next-workout preview
      'workout-recap:', 'workout-timing:', 'workout-energy:', 'workout-hr:',
      'next-session-prescription',
    ]))
  })

  it('invalidateReadinessInputs clears readiness + weekly + progress-summary', async () => {
    await invalidateReadinessInputs()
    expect(invalidated).toEqual(expect.arrayContaining(['readiness-score', 'weekly-stats', 'progress-summary']))
  })

  it('invalidateProgramStructure clears program + next-session + styles + the AI prescription seed', async () => {
    await invalidateProgramStructure()
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-data', 'next-session', 'progression-styles', 'muscle-recovery', 'program-week',
      'workout-card:', 'phase-sets',
      // A program edit voids the server prescription, so its seed + overview must drop too.
      'ai-periodization-session:', 'ai-periodization-overview', 'weekly-volume-target',
    ]))
  })

  it('invalidateGoalRecommendations clears nutrition/body/progress/user-goals caches', async () => {
    await invalidateGoalRecommendations()
    expect(invalidated).toEqual(expect.arrayContaining([
      'nutrition-targets', 'body-metadata', 'progress-summary', 'user-goals', 'more-user-profile',
      // LB-48. Recommended calories route through `personalRmr`, so a saved RMR test changes them.
      'measured-rmr',
    ]))
    // nutrition-user-profile was collapsed into more-user-profile (CACHE-F13)
    expect(invalidated).not.toContain('nutrition-user-profile')
  })

  it('invalidateOuraSync clears every Oura-derived cache including the oura-hr-day prefix', async () => {
    await invalidateOuraSync()
    expect(invalidated).toEqual(expect.arrayContaining([
      'body-metadata', 'sleep-sessions', 'readiness-score',
      'oura-stats', 'oura-hr-day:', 'home-day-timeline',
      'training-load', 'progress-summary', 'weekly-stats', 'health-trends:',
      'health-trends-summary', 'sleep-performance-correlation',
    ]))
  })

  it('invalidateBiometrics clears body/sleep/readiness caches and sleep-performance-correlation', async () => {
    await invalidateBiometrics()
    expect(invalidated).toEqual(expect.arrayContaining([
      'body-metadata', 'sleep-sessions', 'readiness-score', 'weekly-stats',
      'progress-summary', 'sleep-performance-correlation',
    ]))
  })

  it('invalidateInjuryWrites clears the injuries cache', async () => {
    await invalidateInjuryWrites()
    expect(invalidated).toEqual(expect.arrayContaining(['injuries']))
  })

  it('invalidateActivityWrites clears timeline + calendar alongside the activity caches', async () => {
    await invalidateActivityWrites()
    expect(invalidated).toEqual(expect.arrayContaining([
      'activity-logs', 'weekly-stats', 'muscle-recovery', 'achievements:',
      'calendar-data:', 'home-day-timeline', 'body-metadata', 'day-log:',
      'health-trends-summary', 'training-load',
    ]))
  })

  it('invalidateBodyMetricWrite clears body-metadata, progress-summary, day-log:, health-trends-summary, and the achievements prefix (W1)', async () => {
    await invalidateBodyMetricWrite()
    expect(invalidated).toEqual(expect.arrayContaining([
      'body-metadata', 'progress-summary', 'day-log:', 'health-trends-summary', 'achievements:',
    ]))
  })

  it('invalidateNutritionWrite clears food logs, weekly summary, timeline, adherence, the F6 sparkline, the health-trends: prefix, and the achievements prefix (W1)', async () => {
    await invalidateNutritionWrite()
    expect(invalidated).toEqual(expect.arrayContaining([
      'nutrition-food-logs-', 'nutrition-weekly-summary', 'body-metadata',
      'home-day-timeline', 'health-trends-summary', 'nutrition-adherence', 'health-trends:', 'achievements:',
    ]))
  })

  it('invalidateFriends clears the friends- prefix', async () => {
    await invalidateFriends()
    expect(invalidated).toEqual(expect.arrayContaining(['friends-']))
  })

  it('invalidateSupplements clears the supplements cache', async () => {
    await invalidateSupplements()
    expect(invalidated).toEqual(expect.arrayContaining(['supplements']))
  })

  it('invalidateHealthTrends clears the health-trends prefix', async () => {
    await invalidateHealthTrends()
    expect(invalidated).toEqual(expect.arrayContaining(['health-trends:']))
  })

  it('invalidateExerciseLogged clears mid-session log caches and the workout-card:<id> key', async () => {
    await invalidateExerciseLogged('sess-1')
    expect(invalidated).toEqual(expect.arrayContaining([
      'weights-summary', 'weekly-stats', 'muscle-recovery', 'strength-trend',
      'exercise-history:', 'day-log:', 'home-day-timeline', 'achievements:',
      'workout-sessions-day:', 'calendar-data:', 'streak-data', 'training-load',
      'muscle-tonnage-trend', 'workout-card:sess-1', 'weekly-muscle-sets',
    ]))
  })

  it('invalidateExerciseLogged skips the workout-card key when no session id is given', async () => {
    await invalidateExerciseLogged()
    expect(invalidated).not.toContain('workout-card:undefined')
  })

  it('invalidateMealTypes clears definitions + adherence', async () => {
    await invalidateMealTypes()
    expect(invalidated).toEqual(expect.arrayContaining(['nutrition-meal-types', 'nutrition-adherence']))
  })

  it('invalidateUserProfile clears the sole /api/user/profile key', async () => {
    await invalidateUserProfile()
    expect(invalidated).toEqual(['more-user-profile'])
  })

  it('invalidateAiPeriodization clears the overview + weekly-volume-target', async () => {
    await invalidateAiPeriodization()
    expect(invalidated).toEqual(expect.arrayContaining(['ai-periodization-overview', 'weekly-volume-target']))
  })

  it('invalidateExerciseLibrary clears the exercise-library cache', async () => {
    await invalidateExerciseLibrary()
    expect(invalidated).toEqual(['exercise-library'])
  })

  it('invalidateActivityTypes clears the activity-types cache', async () => {
    await invalidateActivityTypes()
    expect(invalidated).toEqual(['activity-types'])
  })

  it('invalidateAdminPendingCount clears the admin-pending-count cache', async () => {
    await invalidateAdminPendingCount()
    expect(invalidated).toEqual(['admin-pending-count'])
  })

  it('invalidatePrescriptionChanged clears workout-data, the workout-card:<id> key, and AI periodization caches', async () => {
    await invalidatePrescriptionChanged('sess-1')
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-data', 'workout-card:sess-1', 'ai-periodization-overview', 'weekly-volume-target',
    ]))
  })

  it('invalidatePrescriptionChanged never builds a workout-card:undefined key', async () => {
    await invalidatePrescriptionChanged()
    expect(invalidated).not.toContain('workout-card:undefined')
    expect(invalidated).not.toContain('ai-periodization-session:undefined')
  })

  // RV-49 — the owner confirmed a deload on Home and the screen kept full-intensity weights.
  // `handleEarlyDeloadConfirm` calls this with NO id (a deload is not scoped to one session), and
  // the per-id eviction Q-117 added was conditional, so that call evicted no cards at all — the
  // exact keys Q-117 was filed about. `next-session` was not in the group either, so Home's
  // recommendation card kept the pre-deload plan too. Both are load-bearing rather than first-paint
  // accelerators: `workout-card:` is fetched with freshWithinTtl and `next-session` has seed-only
  // readers, so this was hard staleness for up to TTL_LONG, not a flash.
  it('invalidatePrescriptionChanged drops EVERY session\'s cards when called with no id', async () => {
    await invalidatePrescriptionChanged()
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-card:', 'ai-periodization-session:',
    ]))
  })

  it('invalidatePrescriptionChanged clears Home\'s recommendation key either way', async () => {
    await invalidatePrescriptionChanged()
    expect(invalidated).toContain('next-session')
    invalidated.length = 0
    await invalidatePrescriptionChanged('sess-1')
    expect(invalidated).toContain('next-session')
  })

  it('invalidatePrescriptionChanged stays PRECISE when an id is given — no prefix sweep', async () => {
    await invalidatePrescriptionChanged('sess-1')
    expect(invalidated).toContain('workout-card:sess-1')
    expect(invalidated).not.toContain('workout-card:')
    expect(invalidated).not.toContain('ai-periodization-session:')
  })

  // Soreness re-derives per-exercise deloads server-side on the next real workout-data
  // read, so a check-in that leaves the 6h workout caches in place is invisible until they
  // expire. Unlike invalidatePrescriptionChanged this is session-agnostic — soreness is not
  // scoped to one session — so both keys must be prefix-invalidated.
  it('invalidateCheckinAffectsPrescription drops every session\'s prescription caches plus readiness', async () => {
    await invalidateCheckinAffectsPrescription()
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-data', 'workout-card:', 'ai-periodization-session:', 'next-session',
      'readiness-score', 'ai-periodization-overview',
    ]))
  })
})

/**
 * RV-50, and what it turned out to be.
 *
 * The entry reported three raw `readCacheSync('workout-card:<id>')` reads that "never revalidate" —
 * the Q-260 seed-only shape, where an evicted key goes blank until something else refills it.
 * Checked against the code, they are not that: `session-select-content.tsx` and
 * `workout-select-content.tsx` both fetch **`workout-data:all`** on mount and seed every
 * `workout-card:<id>` from its `onData`, then bump an epoch counter (`dataEpoch`,
 * `workoutCardEpoch`) that is threaded into the reading `useMemo`s precisely so the synchronous
 * reads re-run once the batch lands. Those counters exist as the fixes for Q-89 and Q-106, which
 * are the bug RV-50 describes. A scan keyed on "is the key this component reads also fetched here"
 * cannot see that pairing, because the key fetched is a different one.
 *
 * What IS unguarded is the invariant the pairing rests on. `workout-data:all` is fetched with
 * `freshWithinTtl: true` at `TTL_LONG`, so if a group ever evicted `workout-card:` while leaving
 * `workout-data:all` fresh, the batch would not refetch, nothing would re-seed the card, and those
 * reads would go blank for up to six hours — which after RV-49 made the eviction actually fire is a
 * worse outcome than the staleness it replaced. Every group pairs them today. Nothing enforced it.
 */
describe('workout-card: is never evicted without the batch that re-seeds it (RV-50)', () => {
  const GROUPS: [string, () => Promise<void>][] = [
    ['invalidateWorkoutSummaries', invalidateWorkoutSummaries],
    ['invalidateExerciseLogged', invalidateExerciseLogged],
    ['invalidateProgramStructure', invalidateProgramStructure],
    ['invalidateInjuryWrites', invalidateInjuryWrites],
    ['invalidatePrescriptionChanged', invalidatePrescriptionChanged],
    ['invalidateCheckinAffectsPrescription', invalidateCheckinAffectsPrescription],
  ]

  it.each(GROUPS)('%s evicts workout-data alongside the card keys', async (_name, run) => {
    await run()
    const evictsCard = invalidated.some(k => k.startsWith('workout-card'))
    if (!evictsCard) return
    // `workout-data` is a PREFIX invalidation, so it covers `workout-data:all` — the batch key —
    // as well as the per-tab ones.
    expect(invalidated.some(k => k === 'workout-data' || k.startsWith('workout-data')),
      'evicted workout-card: without the workout-data batch that re-seeds it').toBe(true)
  })

  it('holds for the per-session form too, which evicts one card rather than the prefix', async () => {
    await invalidatePrescriptionChanged('session-1')
    expect(invalidated).toContain('workout-card:session-1')
    expect(invalidated.some(k => k.startsWith('workout-data'))).toBe(true)
  })

  it('and the six groups above are still all of them', async () => {
    // A seventh group evicting the card key would not be covered by the cases above, and the
    // pairing is exactly what stops the reads going blank.
    const src = readFileSync(join(__dirname, '..', 'cache-groups.ts'), 'utf8')
    const owners = [...src.matchAll(/export async function (invalidate\w+)[\s\S]*?\n\}/g)]
      .filter(m => /workout-card/.test(m[0]))
      .map(m => m[1])
    expect(owners.sort()).toEqual(GROUPS.map(([n]) => n).sort())
  })
})
