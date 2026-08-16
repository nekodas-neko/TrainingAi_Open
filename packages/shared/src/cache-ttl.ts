// TTL constants (seconds) — single source of truth for client cache TTLs,
// so screens don't couple to the sync-engine module graph in components/sync-provider.
export const TTL_SHORT = 5 * 60;       // 5 min — data that changes during a workout
export const TTL_MEDIUM = 30 * 60;     // 30 min — daily stats
export const TTL_LONG = 6 * 60 * 60;   // 6 h — slow-changing config

// Canonical per-key TTLs — readiness-score and muscle-recovery were previously
// fetched with divergent TTLs across call sites, making freshness last-writer-wins.
// Every call site imports these instead of hardcoding a raw TTL_* constant.
export const READINESS_SCORE_TTL = TTL_SHORT;
export const MUSCLE_RECOVERY_TTL = TTL_LONG;

// The steps-motion decoder's dequantisation table (Q-221). It is a frozen wire-format spec — it
// changes only if the ring's firmware model version does — so the long TTL is generous rather than
// risky, and the cached copy is what lets activity auto-detection keep working offline after one
// successful fetch.
export const STEPS_DECODER_CONSTANTS_TTL = TTL_LONG;
// body-battery — a "today" metric fetched at 3 sites; one canonical TTL (W1).
export const BODY_BATTERY_TTL = TTL_SHORT;
// running-plan next-run prescription — changes intra-day as runs are logged.
export const RUNNING_PLAN_TTL = TTL_SHORT;
// training-stress (OTS): a whole-day rolling metric shown on the done-screen + health card.
export const TRAINING_STRESS_TTL = TTL_MEDIUM;
// zone-minutes daily rollups — today is partial (re-derived server-side), past days are cached.
export const ZONE_MINUTES_TTL = TTL_MEDIUM;
// next-session was previously fetched with a raw 60s literal at one call site vs
// TTL_SHORT (300s) at the others — canonicalized to the majority value.
export const NEXT_SESSION_TTL = TTL_SHORT;
// exercise-history: was previously TTL_SHORT at one call site vs TTL_MEDIUM at
// another for the same key prefix — canonicalized to MEDIUM (a workout logged for
// that exercise explicitly invalidates the prefix via invalidateWorkoutSummaries(),
// so a longer passive TTL doesn't risk staleness between logs).
export const EXERCISE_HISTORY_TTL = TTL_MEDIUM;

// day-log: read by the week-day sheet and the day-detail screen. Named here the moment it reached
// two call sites, per the one-canonical-TTL-per-key rule — both were TTL_MEDIUM already, so this
// pins the agreement rather than changing behaviour.
export const DAY_LOG_TTL = TTL_MEDIUM;
// exercise HR trend (per-set HR snapshot rollup) — server-derived after each workout recap,
// no client write path, so a medium passive TTL is safe.
export const EXERCISE_HR_TREND_TTL = TTL_MEDIUM;
// HR Recovery Profile (peak-HR-band aggregation) — same rationale as EXERCISE_HR_TREND_TTL.
export const HR_RECOVERY_PROFILE_TTL = TTL_MEDIUM;
// food logs change while a user is actively logging a meal — a short 60s TTL
// keeps the day's log from feeling stale mid-session without hammering the API.
export const NUTRITION_FOOD_LOGS_TTL = 60;
// mood:<date> is fetched at 2 sites (mood-checkin-sheet, session-select) — named
// so a future divergent raw TTL_* import at a new call site can't drift (CCH-8).
export const MOOD_TTL = TTL_SHORT;

/** `energy-balance:<date>` — calories in vs out for one day. Both sides move while the user is
 *  logging (food in, workouts/steps out), so it is short-lived as well as write-invalidated.
 *  The date is in the key, so a cached "today" can never be served across midnight. */
export const ENERGY_BALANCE_TTL = TTL_SHORT;

/** /api/health/trends summary payload — fetched by 5 sibling cards. */
export const HEALTH_TRENDS_SUMMARY_TTL = TTL_LONG;

/** /api/hr-profile — age-predicted HRmax + resting-HR baseline for live workout HR
 *  zones. Changes over months (age) / days (RHR), so a long TTL is safe. */
export const HR_PROFILE_TTL = TTL_LONG;

/** /api/oura/hr-window, keyed `hr-window:<query>` — the HR trace for one past activity's
 *  time window. The window is immutable once the activity is logged, but the route
 *  back-fills from Oura on demand, so an early read can legitimately return an empty
 *  trace that fills in later. MEDIUM rather than LONG so a miss self-heals within the
 *  half hour even if no write group fires; invalidateOuraSync() clears the prefix the
 *  moment new HR rows land. */
export const HR_WINDOW_TTL = TTL_MEDIUM;

/** /api/coach/threads — the Coach history list (past conversations + applied changes).
 *  Changes only when a conversation is saved or a change applied, and every one of those
 *  writes calls invalidateCoachHistory(), so the passive TTL is a backstop rather than the
 *  freshness mechanism. */
export const COACH_HISTORY_TTL = TTL_LONG;

/** Done-screen per-session payloads, keyed `<name>:<workoutSessionId>`.
 *  A completed session's recap, timing breakdown and energy estimate are immutable once
 *  written, so they take the long TTL — the point is that re-opening the done screen
 *  paints instantly instead of firing six uncached round-trips at the exact moment
 *  complete-workout is still doing HR sync and the next prescription's regeneration. */
export const WORKOUT_RECAP_TTL = TTL_LONG;
export const WORKOUT_TIMING_TTL = TTL_LONG;
export const WORKOUT_ENERGY_TTL = TTL_LONG;

/** Workout HR payload (`workout-hr:<workoutSessionId>`). Deliberately SHORT, unlike its
 *  siblings above: BLE heart-rate lands asynchronously, so an early read legitimately
 *  returns `ready: false` and must not be cached for six hours. */
export const WORKOUT_HR_TTL = TTL_SHORT;

/** /api/next-session/prescription — the done screen's "Next workout" card. Changes when a
 *  prescription is (re)generated, which the prescription cache groups already invalidate. */
export const NEXT_SESSION_PRESCRIPTION_TTL = TTL_SHORT;

/** /api/fitness-tests — baseline results change only when a test is completed
 *  (which explicitly invalidates the key), so a medium TTL is safe. */
export const FITNESS_TESTS_TTL = TTL_MEDIUM

/** /api/admin/ai-usage — the AI-usage observability readout. Aggregates append-only
 *  ai_call_log; seed-then-revalidate for instant paint (per Workstream A). Short TTL
 *  so the admin sees fresh call counts without hammering the aggregate queries. */
export const AI_USAGE_TTL = TTL_SHORT;

/** Cardiovascular hub week payload (`cardio-week`). Short — the quota moves as HR lands, and
 *  today's zone-seconds are recomputed on every read anyway. One canonical TTL, one call site. */
export const CARDIO_WEEK_TTL = TTL_SHORT;

// Cardio trends (weekly zone stacks, efficiency curve, cadence trend) — multi-week history
// changes slowly; same TTL tier as the existing health-trends surface (TTL_MEDIUM).
export const CARDIO_TRENDS_TTL = TTL_MEDIUM;

// Running all-time bests (best 1K/5K, best pace, longest run) — changes only when a new
// PR run is logged, so a long passive TTL is safe.
export const RUNNING_BESTS_TTL = TTL_LONG;

// Running stats by run type (avg pace/distance/HR per tempo/easy/long/etc.) — same
// changes-only-on-a-new-completed-run cadence as RUNNING_BESTS_TTL, same long TTL.
export const RUN_TYPE_STATS_TTL = TTL_LONG;

// Guided-walk fast/slow segment stats (avg pace/distance/HR per block, across past walks) —
// changes only when a new interval walk is completed, so a long passive TTL is safe.
export const WALK_SEGMENT_STATS_TTL = TTL_LONG;

// Offline seed floor — the localStorage cache seed (readCacheSync's fallback) is
// kept at least this long regardless of the key's real TTL, so a fully-offline
// device still paints last-known data. Raised from 24h to 7d (offline-shell work,
// 2026-07-11). This only governs how long a seed survives WITHOUT a successful
// refetch — online freshness is unchanged (SWR refetch still fires every mount).
export const OFFLINE_SEED_TTL_FLOOR = 7 * 24 * 60 * 60;

export function floorSeedTtl(ttlSeconds: number): number {
  return Math.max(ttlSeconds, OFFLINE_SEED_TTL_FLOOR);
}
