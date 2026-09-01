import { invalidateCache } from '@/lib/sqlite/cache'

/** Legacy sessionStorage seeds read by session-select-content's first-paint effect.
 *  They live outside the TTL cache, so every group that invalidates workout-data:meta
 *  or next-session MUST also clear these — a stale seed wins the first-paint race. */
function clearLegacyHomeSeeds(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem('ta_recommendation_v1')
    sessionStorage.removeItem('ta_meta_v1')
  } catch { /* sessionStorage unavailable */ }
}

/** Caches that derive from workout/set data — invalidate after completing a workout. */
export async function invalidateWorkoutSummaries(): Promise<void> {
  await Promise.all([
    // a completed strength session adds to calories OUT for the day
    invalidateCache('energy-balance:'),
    invalidateCache('weekly-stats'),
    invalidateCache('weekly-muscle-sets'),
    invalidateCache('weights-summary'),
    invalidateCache('next-session'),
    invalidateCache('muscle-recovery'),
    invalidateCache('readiness-score'),
    // prefix-invalidate every `achievements:<userId>` entry (one per logged-in device user)
    invalidateCache('achievements:'),
    invalidateCache('progress-summary'),
    // streak count and calendar dots both change after a workout is logged
    invalidateCache('streak-data'),
    // a lifting session's HR feeds the same whole-day zone series as any cardio activity
    invalidateCache('cardio-week'),
    invalidateCache('calendar-data:'),
    invalidateCache('strength-trend'),
    invalidateCache('day-log:'),
    // training-tab derived data
    invalidateCache('training-load'),
    // per-day HR zone rollups (a completed workout's HR feeds oura_heartrate)
    invalidateCache('zone-minutes:'),
    invalidateCache('sleep-performance-correlation'),
    invalidateCache('ai-periodization-overview'),
    invalidateCache('weekly-volume-target'),
    invalidateCache('workout-data:meta'),
    // the home/workout-select ?tab=all batch that seeds every workout-card:<id>
    invalidateCache('workout-data:all'),
    // home timeline event strip + the HR chart "Workout" overlay band
    invalidateCache('home-day-timeline'),
    invalidateCache('workout-sessions-day:'),
    // the user's own sessions/volume/streak feed the leaderboard
    invalidateCache('friends-leaderboard'),
    // prefix-invalidate every `exercise-history:<name>` entry
    invalidateCache('exercise-history:'),
    invalidateCache('program-week'),
    // session-rpe/rest-adherence/recovery-vs-strength trend views
    invalidateCache('health-trends:'),
    // completing a workout advances program-wide phase counters shown on every
    // session's pre-workout card (freshWithinTtl, TTL_LONG — must be corrected)
    invalidateCache('workout-card:'),
    // F6 workout-density/duration sparklines — bare key, deliberately distinct from
    // the `health-trends:<view>` prefix family above (a same-prefix bare key would
    // either never match via LIKE-prefix invalidation, or over-match the sibling
    // family — see `health-trends-summary`'s consumers for the full explanation)
    invalidateCache('health-trends-summary'),
    invalidateCache('muscle-tonnage-trend'),
    // prefix-invalidate every `workout-load-history:<sessionName>` entry
    invalidateCache('workout-load-history:'),
    // B2: a completed workout changes the running gate (hoursSinceLowerBodyStrength,
    // ACWR/strain) → the running-plan prescription.
    invalidateCache('running-plan'),
    // B3/B4: a workout's HR/MET feeds OTS + body battery.
    invalidateCache('training-stress'),
    invalidateCache('body-battery'),
    // Done-screen per-session payloads (prefix — one entry per completed session). A new
    // completion changes which session is "latest" and produces the next prescription, so
    // the done screen must not repaint the previous workout's recap/timing/HR.
    invalidateCache('workout-recap:'),
    invalidateCache('workout-timing:'),
    invalidateCache('workout-energy:'),
    invalidateCache('workout-hr:'),
    invalidateCache('next-session-prescription'),
    // Q-126: both derive from set_hr_stats, which completing a workout writes, and neither
    // appeared in any group. exercise-hr-trend is per-exercise, so it drops by prefix.
    invalidateCache('hr-recovery-profile'),
    invalidateCache('exercise-hr-trend:'),
  ])
  clearLegacyHomeSeeds()
}

/** Caches that change when a single exercise is logged mid-session (not a full
 *  workout completion). Superset of the ad-hoc list previously inlined in
 *  workout-screen; the completion path still calls invalidateWorkoutSummaries(). */
export async function invalidateExerciseLogged(programSessionId?: string): Promise<void> {
  await Promise.all([
    invalidateCache('weights-summary'),
    invalidateCache('weekly-stats'),
    invalidateCache('muscle-recovery'),
    invalidateCache('strength-trend'),
    invalidateCache('exercise-history:'),        // prefix — all exercises (cheap; re-log affects history)
    invalidateCache('day-log:'),
    invalidateCache('home-day-timeline'),
    invalidateCache('achievements:'),
    invalidateCache('workout-sessions-day:'),
    invalidateCache('calendar-data:'),
    invalidateCache('streak-data'),
    invalidateCache('training-load'),
    invalidateCache('muscle-tonnage-trend'),
    invalidateCache('weekly-muscle-sets'),
    // the home/workout-select ?tab=all batch that seeds every workout-card:<id>
    invalidateCache('workout-data:all'),
    ...(programSessionId ? [invalidateCache(`workout-card:${programSessionId}`)] : []),
  ])
}

/** Caches that derive from sleep/mood/body inputs — invalidate after those writes. */
export async function invalidateReadinessInputs(): Promise<void> {
  await Promise.all([
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
    invalidateCache('progress-summary'),
    invalidateCache('muscle-recovery'),
    // B4: body battery derives from readiness inputs (sleep/stress/HR).
    invalidateCache('body-battery'),
  ])
}

/** Caches that derive from program/style structure — invalidate after config edits. */
export async function invalidateProgramStructure(): Promise<void> {
  await Promise.all([
    invalidateCache('workout-data'),
    invalidateCache('workout-templates'),
    invalidateCache('next-session'),
    invalidateCache('progression-styles'),
    invalidateCache('muscle-recovery'),
    invalidateCache('program-week'),
    // pre-workout card prefetch (freshWithinTtl, TTL_LONG) shows the exercise
    // list/phase status as of the last edit — must be corrected on any program change
    invalidateCache('workout-card:'),
    invalidateCache('phase-sets'),
    // An edit clears the server-side AI prescription (workout-templates route), so the
    // per-session prescription seed and the AI overview must drop too — otherwise the
    // screen re-paints the pre-edit prescription from cache before the refetch lands.
    invalidateCache('ai-periodization-session:'),
    invalidateAiPeriodization(),
  ])
  clearLegacyHomeSeeds()
}

/** Caches that derive from biometric sync — invalidate after pullDelta brings new body/sleep/mood rows. */
export async function invalidateBiometrics(): Promise<void> {
  await Promise.all([
    // a weight/step write moves both the burn estimate and the calibration window
    invalidateCache('energy-balance:'),
    invalidateCache('body-metadata'),
    invalidateCache('sleep-sessions'),
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
    invalidateCache('progress-summary'),
    invalidateCache('sleep-performance-correlation'),
    // a manual weight/step entry changes the hub's step-quota reads
    invalidateCache('cardio-week'),
    // Q-126: sleep rows feed computeAchievements' sleep streak (lib/achievements.ts:150,211).
    // The same "feeds computeAchievements" sweep added this for body-metrics and nutrition and
    // missed sleep, so a sleep-streak badge never refreshed until some other write cleared it.
    invalidateCache('achievements:'),
  ])
}

/** Caches that derive from goals/activity-level/nutrition targets — invalidate after
 *  applying a goal recommendation or editing activity level/fitness goal in Profile. */
export async function invalidateGoalRecommendations(): Promise<void> {
  await Promise.all([
    // the fitness goal sets the target net the bar bands against
    invalidateCache('energy-balance:'),
    invalidateCache('nutrition-targets'),
    invalidateCache('body-metadata'),
    invalidateCache('progress-summary'),
    invalidateCache('user-goals'),
    // fitnessGoal feeds the nutrition screen's TDEE-adaptation-card check
    invalidateCache('more-user-profile'),
  ])
}

/** Caches that derive from Oura data — invalidate after a manual/automatic Oura sync. */
export async function invalidateOuraSync(): Promise<void> {
  await Promise.all([
    invalidateCache('body-metadata'),
    invalidateCache('sleep-sessions'),
    invalidateCache('readiness-score'),
    invalidateCache('oura-stats'),
    // A BLE sync drains new keepalive battery polls, so the latest-battery read is stale after
    // one. Read by both Ring Status cards (More/Profile and Health) on this single shared key.
    invalidateCache('oura-ble-battery-latest'),
    // prefix-invalidate every `oura-hr-day:<date>` entry
    invalidateCache('oura-hr-day:'),
    // per-day HR zone rollups (an Oura sync brings new oura_heartrate rows)
    invalidateCache('zone-minutes:'),
    // new HR rows change the hub's quota actuals and observed HR profile
    invalidateCache('cardio-week'),
    invalidateCache('home-day-timeline'),
    invalidateCache('training-load'),
    invalidateCache('progress-summary'),
    invalidateCache('weekly-stats'),
    // readiness/sleep/meal-timing trend views
    invalidateCache('health-trends:'),
    // wear-time/HRV F6 sparklines (bare key, distinct from the health-trends: family)
    invalidateCache('health-trends-summary'),
    // exercise-detected-card's unreviewed-Oura-workouts list
    invalidateCache('oura-unreviewed-workouts'),
    invalidateCache('sleep-performance-correlation'),
    // B3/B4/B5: a drain brings new HR/MET/RHR → OTS, body battery, and the HR profile.
    invalidateCache('training-stress'),
    invalidateCache('body-battery'),
    invalidateCache('hr-profile'),
    // Per-activity HR traces (`hr-window:<query>`). The window is fixed, but the samples
    // inside it are exactly what a sync brings — an activity reviewed before its HR landed
    // caches an empty trace, and only this clears it.
    invalidateCache('hr-window:'),
    // Q-126: same sleep-streak gap as invalidateBiometrics above — a sync is the main way new
    // sleep_sessions rows arrive.
    invalidateCache('achievements:'),
  ])
}

/** Caches that derive from injuries — invalidate after injury add/edit/resolve/delete.
 *
 *  An injury changes what the AI-dynamic engine prescribes (workout-data/route.ts folds
 *  unresolved injuries into the deload decision), but until Q-117 this group only cleared the
 *  `injuries` cache itself — `workout-data:*`/`workout-card:*`/`ai-periodization-session:*` stayed
 *  cached at TTL_LONG under freshWithinTtl, so the pre-workout screen kept showing the pre-injury
 *  plan for up to 6 hours after logging an injury. */
export async function invalidateInjuryWrites(): Promise<void> {
  await Promise.all([
    invalidateCache('injuries'),
    invalidateCache('workout-data'),
    invalidateCache('workout-card:'),
    invalidateCache('ai-periodization-session:'),
  ])
  // Same reason as invalidatePrescriptionChanged/invalidateCheckinAffectsPrescription: the
  // 'workout-data' prefix-drop above includes `workout-data:meta`, and a surviving legacy seed
  // would re-paint the pre-injury plan on Home's first paint regardless.
  clearLegacyHomeSeeds()
}

/** Every cache that renders a saved activity (walk/run/treadmill). */
export async function invalidateActivityWrites(): Promise<void> {
  await Promise.all([
    // a logged activity changes calories OUT for that day
    invalidateCache('energy-balance:'),
    invalidateCache('activity-logs'),
    invalidateCache('weekly-stats'),
    invalidateCache('muscle-recovery'),
    invalidateCache('achievements:'),
    invalidateCache('calendar-data:'),
    invalidateCache('home-day-timeline'),
    // treadmill steps fold into the day/week step totals (body-metadata)
    invalidateCache('body-metadata'),
    invalidateCache('day-log:'),
    // walks/runs feed the training-load ACWR + the F6 health-trends sparkline
    invalidateCache('training-load'),
    invalidateCache('health-trends-summary'),
    // an activity with HR readings changes the day's zone rollups
    invalidateCache('zone-minutes:'),
    // a logged walk/run/activity draws down the hub's shared weekly quota
    invalidateCache('cardio-week'),
    // B2: a logged run/activity feeds the running gate (hoursSinceLastRun, runsThisWeek).
    invalidateCache('running-plan'),
    // B3/B4: HR readings feed OTS + body battery.
    invalidateCache('training-stress'),
    invalidateCache('body-battery'),
    // Q-126: four stat caches read activity_logs directly and were all missing here. Each holds
    // 6 h, so setting a 5K PB left the All-Time Bests card showing the old number for the rest of
    // the morning.
    invalidateCache('running-bests'),
    invalidateCache('run-type-stats'),
    invalidateCache('walk-segment-stats'),
    invalidateCache('cardio-trends'),
  ])
}

/** Every cache that renders a saved fitness-test / baseline. */
export async function invalidateFitnessTests(): Promise<void> {
  await Promise.all([
    invalidateCache('fitness-tests'),
    invalidateCache('home-day-timeline'),
    // B2: a cardio fitness test changes the snapshot (VO₂max/maxHr → target HR zones)
    // the running prescription uses.
    invalidateCache('running-plan'),
  ])
}

/** The running-plan screen's next-run prescription (changes as runs are logged). */
export async function invalidateRunningPlan(): Promise<void> {
  await invalidateCache('running-plan')
}

/** Caches that render body-metric quick logs (water, weight, steps). */
export async function invalidateBodyMetricWrite(): Promise<void> {
  await Promise.all([
    // weight feeds the calibrated maintenance; steps feed the burned side
    invalidateCache('energy-balance:'),
    invalidateCache('body-metadata'),
    invalidateCache('progress-summary'),
    invalidateCache('day-log:'),
    // steps/water F6 sparklines read this payload
    invalidateCache('health-trends-summary'),
    // B3/B5: RHR/weight feed OTS and the DOB+28-day-RHR HR profile.
    invalidateCache('training-stress'),
    invalidateCache('hr-profile'),
    // W1: body_metrics feeds computeAchievements (weight/steps milestones), same as
    // invalidateActivityWrites — without this the Profile achievements card stays stale
    // for a full TTL after a weight/step entry.
    invalidateCache('achievements:'),
  ])
}

/** Friend graph changed (request sent/accepted/declined/removed) — clear list, feed, leaderboard. */
export async function invalidateFriends(): Promise<void> {
  await invalidateCache('friends-')
}

/** Supplement definitions or today's logs changed. */
export async function invalidateSupplements(): Promise<void> {
  await invalidateCache('supplements')
}

/** Caches behind the Health > Progress Trends card — invalidate after any write that
 *  feeds a correlation view (session RPE, rest adherence, recovery calibration, meal timing). */
export async function invalidateHealthTrends(): Promise<void> {
  await invalidateCache('health-trends:')
}

/** User profile fields (name, avatar, fitness goal, etc.) changed. The sole
 *  /api/user/profile cache key after the nutrition-user-profile/more-user-profile
 *  key collapse (CACHE-F13). */
export async function invalidateUserProfile(): Promise<void> {
  await invalidateCache('more-user-profile')
}

/** A Coach conversation was saved, or a suggested change applied — both change the
 *  history list the Coach screen paints from its cache seed. */
export async function invalidateCoachHistory(): Promise<void> {
  await invalidateCache('coach-history')
}

/** Oura PAT/OAuth token connected or disconnected. */
/** The Ring Status cards' explicit battery re-read (More/Profile's tab-show refresh).
 *  Not a mutation invalidation — the BLE keepalive poll advances on the device, independently of
 *  anything the app writes, so a TTL-cached reading has to be dropped to see a new one. The same
 *  key is also cleared by invalidateOuraSync(), which is the sync-driven path. */
export async function invalidateRingBattery(): Promise<void> {
  await invalidateCache('oura-ble-battery-latest')
}

/** AI periodization state regenerated/overridden. */
export async function invalidateAiPeriodization(): Promise<void> {
  await Promise.all([
    invalidateCache('ai-periodization-overview'),
    invalidateCache('weekly-volume-target'),
  ])
}

/** A prescription was accepted/dismissed or a phase transition executed (CCH-1) —
 *  the pre-workout card's freshWithinTtl `workout-card:<id>` prefetch and the
 *  `workout-data:<tab>` exercise list it derives from both go stale. Call before
 *  the respond/transition success callback fires (invalidate-before-refetch). */
export async function invalidatePrescriptionChanged(programSessionId?: string): Promise<void> {
  await Promise.all([
    invalidateCache('workout-data'),
    // The done screen's "Next workout" card renders this same prescription.
    invalidateCache('next-session-prescription'),
    ...(programSessionId
      ? [invalidateCache(`workout-card:${programSessionId}`), invalidateCache(`ai-periodization-session:${programSessionId}`)]
      : []),
    invalidateAiPeriodization(),
  ])
  // B7: `invalidateCache('workout-data')` prefix-drops `workout-data:meta`, so this
  // group must also clear the legacy home seeds — else home's first paint re-hydrates
  // the pre-transition phase state from the surviving `ta_meta_v1` seed (the invariant
  // at the top of this file).
  clearLegacyHomeSeeds()
}

/** A readiness check-in (mood/soreness or the morning scales) was saved.
 *
 *  Soreness is the one signal that changes TODAY's prescription after it was generated:
 *  `reevaluatePrescriptionForToday` re-derives per-exercise deloads against it server-side,
 *  without re-running the LLM. That re-derivation only happens on a real `/api/workout-data`
 *  read, so leaving the 6-hour `workout-data:*` / `workout-card:*` caches in place meant a
 *  check-in could be logged and the pre-workout screen would still paint the pre-check-in
 *  plan (invalidateReadinessInputs alone never touched them).
 *
 *  Unlike invalidatePrescriptionChanged, this takes no session id and prefix-drops EVERY
 *  session's keys — soreness is not scoped to the session you happen to be looking at. */
export async function invalidateCheckinAffectsPrescription(): Promise<void> {
  await Promise.all([
    invalidateReadinessInputs(),
    invalidateCache('workout-data'),
    invalidateCache('workout-card:'),
    invalidateCache('ai-periodization-session:'),
    invalidateCache('next-session'),
    invalidateCache('next-session-prescription'),
    invalidateAiPeriodization(),
  ])
  // Same reason as invalidatePrescriptionChanged: 'workout-data' prefix-drops
  // `workout-data:meta`, and a surviving legacy seed would re-paint the pre-check-in state.
  clearLegacyHomeSeeds()
}

/** BF-84 — the user chose (or un-chose) a rest day, so only today's recommendation moves.
 *
 *  Narrower than invalidateCheckinAffectsPrescription on purpose: a rest choice changes what
 *  `getNextSession` answers and nothing about readiness inputs, muscle recovery or workout data.
 *  `clearLegacyHomeSeeds()` is still required — `ta_recommendation_v1` survives a plain
 *  `invalidateCache('next-session')` and would re-paint the pre-choice recommendation on Home. */
export async function invalidateRestDayChoice(): Promise<void> {
  await Promise.all([
    invalidateCache('next-session'),
    invalidateCache('next-session-prescription'),
  ])
  clearLegacyHomeSeeds()
}

/** Exercise library entry added/edited/deleted (user custom or admin catalogue). */
export async function invalidateExerciseLibrary(): Promise<void> {
  await invalidateCache('exercise-library')
}

/** Activity type catalogue added/edited/deleted (admin). */
export async function invalidateActivityTypes(): Promise<void> {
  await invalidateCache('activity-types')
}

/** A pending user was activated/deactivated (admin) — the pending-count badge changes. */
export async function invalidateAdminPendingCount(): Promise<void> {
  await invalidateCache('admin-pending-count')
}

/** Caches that render logged food / nutrition totals — invalidate after any food-log
 *  write (create, edit, or delete) or meal-item log. Single source of truth for this
 *  key list so the create/edit/delete paths can't drift apart. */
/** Meal plan created/edited/activated/deleted, or the user's dietary restrictions changed. */
export async function invalidateMealPlans(): Promise<void> {
  await Promise.all([
    invalidateCache('meal-plans'),
    invalidateCache('meal-plan-active'),
    // The restriction set is snapshotted into a plan at generation time and drives the picker.
    invalidateCache('dietary-restrictions'),
  ])
}

export async function invalidateNutritionWrite(): Promise<void> {
  await Promise.all([
    // calories IN changed — the energy-balance bar and its calibration window both move
    invalidateCache('energy-balance:'),
    // Q-387: "I have finished logging" is a nutrition write, and it is the ONLY writer of
    // `day_checkins.food_logging_completed_at` — the check-in sheets COALESCE that column rather
    // than setting it, so no other path can make this key stale.
    invalidateCache('day-checkin:'),
    // prefix-invalidate every `nutrition-food-logs-<date>` entry
    invalidateCache('nutrition-food-logs-'),
    invalidateCache('nutrition-weekly-summary'),
    invalidateCache('body-metadata'),
    // Home's day timeline renders logged meals
    invalidateCache('home-day-timeline'),
    // protein/steps/water F6 sparklines (bare key, distinct from health-trends:)
    invalidateCache('health-trends-summary'),
    invalidateCache('nutrition-adherence'),
    // meal-timing correlation view buckets food logs
    invalidateCache('health-trends:'),
    // logging a food can create a new food item (scan/manual entry)
    invalidateCache('nutrition-food-items-all'),
    // logging a food changes the "recently logged" list for its meal type
    invalidateCache('nutrition-recent-for-meal:'),
    // W1: food_logs + nutrition_targets feed computeAchievements (nutrition milestones),
    // same as invalidateActivityWrites — keeps the Profile achievements card fresh.
    invalidateCache('achievements:'),
  ])
}

/** Meal-type definitions changed — clears the definitions list and the adherence
 *  view that buckets logs by meal type. */
export async function invalidateMealTypes(): Promise<void> {
  await Promise.all([
    invalidateCache('nutrition-meal-types'),
    invalidateCache('nutrition-adherence'),
  ])
}

/**
 * A food ITEM was created (the meal builder's three add paths, and anything else that mints one
 * outside a food log).
 *
 * Distinct from the food-LOG group: creating a library item changes no totals, so invalidating the
 * whole nutrition write group would be wasteful. It does change the Food Library sheet's list,
 * which is seeded from `nutrition-food-items-all` at TTL_MEDIUM — before this existed, a food you
 * had just created was missing from that sheet until the TTL expired.
 */
export async function invalidateFoodItems(): Promise<void> {
  await invalidateCache('nutrition-food-items-all')
}

/** Saved-meal definitions changed (create/update/delete in the saved-meals sheet). */
export async function invalidateSavedMeals(): Promise<void> {
  await invalidateCache('saved-meals')
}

/** A detected-workout suggestion was marked reviewed or dismissed (exercise-detected-card,
 *  exercise-review-sheet). Distinct from invalidateOuraSync — that's a full BLE/Cloud sync
 *  bringing new data; this is just clearing one dismissed/reviewed suggestion off the list. */
export async function invalidateOuraWorkoutReview(): Promise<void> {
  await invalidateCache('oura-unreviewed-workouts')
}

/** The Home header's manual "Refresh" button. Narrower than invalidateWorkoutSummaries() (which
 *  fires on an actual completed workout) — this only needs the pre-workout card's cached tab
 *  meta cleared before its own immediate refetch. `workout-data:meta` is one of the two keys the
 *  module-level clearLegacyHomeSeeds invariant above covers, so this must clear those too. */
export async function invalidateWorkoutMetaRefresh(): Promise<void> {
  await invalidateCache('workout-data:meta')
  clearLegacyHomeSeeds()
}

/** completeWorkout()'s immediate, synchronous-fire clear of workout-data — fired before its own
 *  readCacheSync reads of calendar-data/streak-data (which invalidateWorkoutSummaries(), called
 *  moments later in the same function, would otherwise have already cleared). Prefix-drops
 *  `workout-data:meta` too, so per the clearLegacyHomeSeeds invariant above this must also clear
 *  the legacy seeds — invalidateWorkoutSummaries() calls it again moments later, harmlessly. */
export async function invalidateWorkoutDataImmediate(): Promise<void> {
  await invalidateCache('workout-data')
  clearLegacyHomeSeeds()
}
