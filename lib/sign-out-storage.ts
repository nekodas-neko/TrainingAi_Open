'use client'

import { DEVICE_LOCAL_PREFERENCES } from '@trainingai/shared/user/preferences'
import { useWorkoutStore } from '@/lib/stores/workout-store'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { useFitnessTestStore } from '@/lib/stores/fitness-test-store'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'

/**
 * #2453 — which `localStorage` / `sessionStorage` keys belong to the phone, and which to the account.
 *
 * The SQLite half of sign-out already worked this way: `KEEP_ON_SIGN_OUT` (`lib/local-store`) names
 * the few tables that survive, and everything else is wiped, so a table added later is cleared by
 * default. Browser storage had no such list. What it had instead was `clearAllCache()` sweeping every
 * key that happened to start with `ta_`, which was wrong in both directions at once:
 *
 * - **Too little.** Keys that do not start `ta_` survived: `auto-detection-store` (detected
 *   activities waiting for review, with their GPS routes), `chat_history_*`, `ta-fitness-test`, and
 *   four upload retry queues (`detection-events-outbox`, `ta-cadence-captures`,
 *   `ta-oura-ble-pending-*`) that would have POSTed the previous account's data under the next one.
 *   `sessionStorage`'s `ta_recommendation_v1` survived too, and session-select paints it on mount.
 * - **Too much.** Every BLE pairing the JS side holds (chest strap, scale, Colmi ring), the ring
 *   capture toggles and the brand theme all start `ta_`, so signing out unpaired the strap and reset
 *   the theme.
 *
 * So the rule is now the SQLite one: **everything is cleared except `DEVICE_STORAGE`**. A key added
 * later is cleared by default, the safe direction for a list whose whole job is not leaving one
 * account's data for the next. `ACCOUNT_STORAGE` changes nothing at runtime — it is the census that
 * `scripts/check-sign-out-clears-storage.js` holds every storage key in the code against, so a new
 * key has to be put on one side or the other on purpose.
 *
 * **The Oura ring is not in either list, because none of it is here.** Its BLE key and history
 * cursor live in native SharedPreferences, which nothing in this file can reach.
 */

/** Exact keys that survive a sign-out. They describe this phone and its hardware, not the person. */
export const DEVICE_STORAGE: Readonly<Record<string, string>> = Object.freeze({
  // The preferences already declared device-local for sync (Q-392): BLE pairings, ring capture
  // toggles, Android status-bar chips, next-themes' light/dark.
  ...DEVICE_LOCAL_PREFERENCES,
  ta_brand_theme: 'appearance — the owner\'s call (#2453): a sign-out must not repaint the app; the next account\'s own theme still arrives with its preference bag',
  ta_brand_hue: 'appearance, the custom half of ta_brand_theme',
  ta_background_settings: 'appearance — weather backgrounds per tab, kept with the theme (#2453)',
  ta_paired_colmi_ring_v1: 'a BLE pairing belongs to the device that holds it',
  ta_colmi_last_auto_sync_v1: 'a throttle on how often the paired ring is polled — a fact about the radio, not a record',
  ta_strap_battery_v1: 'last-seen battery of the paired chest strap — hardware, deliberately not a preference (Q-111)',
  'ta-oura-ble-soak-log': 'ring battery soak diagnostics — about the ring hardware, not anyone\'s data',
  'ta-oura-ble-continuous-diag': 'ring capture diagnostics — about the BLE link, not anyone\'s data',
  'ta-oura-ble-raw-maint-diag': 'raw-store maintenance results, row counts and cutoffs only — about this phone\'s oura_raw.db, which a sign-out does not clear either (#2579)',
  'ta-oura-ble-raw-marked-by-day': 'marked-row counts per day for this phone\'s oura_raw.db, the prune estimate — dropping it would undercount a store a sign-out leaves in place (#2579)',
  ta_nav_timing_v1: 'navigation timing samples for this WebView — performance diagnostics',
  'ta-history-entry-depth': 'sessionStorage: where this tab\'s history begins, so Back does not leave the app',
})

/**
 * The localStorage upload queues (JSON arrays of items not yet POSTed). They are the account's and
 * are cleared with it, so a sign-out discards whatever they still hold: issue 2532 counts them as
 * unsent changes before signing out (`lib/sign-out-pending.ts`). One list for both, so a new queue
 * is cleared and counted, never only one of the two.
 */
export const UPLOAD_QUEUE_STORAGE: Readonly<Record<string, string>> = Object.freeze({
  'detection-events-outbox': 'unsent activity-detection telemetry',
  'ta-cadence-captures': 'unsent cadence calibration captures',
  'ta-oura-ble-pending-live-steps': 'unsent live-step windows (manual tester)',
  'ta-oura-ble-pending-live-steps-auto': 'unsent live-step windows',
  'ta-oura-ble-pending-accel-chunks': 'unsent accelerometer chunks',
})

/**
 * Keys and key prefixes that are the account's, and are cleared. Documentation and census only —
 * clearing does not read this list (it clears everything not in `DEVICE_STORAGE`).
 */
export const ACCOUNT_STORAGE: Readonly<Record<string, string>> = Object.freeze({
  // Persisted Zustand stores — reset in memory first, see resetAccountStores().
  ta_workout_state: 'the in-progress workout: session, sets, weights, today\'s logged exercises',
  ta_activity_state: 'the in-progress tracked activity',
  ta_guided_walk_v1: 'the in-progress guided walk and its GPS points',
  'ta-fitness-test': 'the chosen fitness-test protocol',
  'auto-detection-store': 'detected activities awaiting review, with their GPS routes',
  // The API cache mirrors, also cleared by clearAllCache().
  'ta_cache:': 'prefix — localStorage mirror of the API cache',
  'ta_sscache:': 'prefix — sessionStorage mirror of the API cache',
  // Server-backed preferences (Q-392): re-seeded from the next account's own bag on sign-in.
  ta_ss_widgets: 'Home widgets', ta_ss_cards: 'Home cards', ta_home_section_order: 'Home layout',
  ta_home_hidden_sections: 'Home layout', ta_pill_colors: 'Home colours', ta_card_colors: 'Home colours',
  ta_score_ring_style: 'Home score ring', ta_weight_lookback: 'weight chart window',
  ta_goals_progress_view: 'goals card view', ta_meal_label_style: 'meal label style',
  ta_rest_duration: 'default rest', ta_food_region: 'food database region',
  ta_pref_meal_reminders: 'reminder toggle', ta_pref_health_alerts: 'alert toggle',
  ta_pref_day_review_reminders: 'reminder toggle', ta_pref_calendar_sync: 'calendar toggle',
  ta_prefs_unsynced: 'preference names whose PATCH is unacknowledged — kept, they would be re-sent to the NEXT account\'s server bag',
  // Goals seeded from the server (Q-241).
  ta_steps_goal: 'goal', ta_steps_goal_type: 'goal', ta_sleep_goal_hours: 'goal',
  ta_calorie_goal_kcal: 'goal', ta_calorie_goal_type: 'goal', ta_water_goal_ml: 'goal',
  ta_water_goal_type: 'goal', ta_target_weight_kg: 'goal', ta_target_bf_pct: 'goal',
  // Day markers and dismissals — one person's day.
  ta_morning_checkin: 'checked in today', ta_rest_day: 'chose a rest day today',
  'ta_early_deload_dismissed_': 'prefix — dismissed the early-deload card this month',
  'ta_day_review_dismissed_': 'prefix — dismissed today\'s day review',
  'ta_weekly_recap_dismissed_': 'prefix — dismissed a weekly recap',
  'ta_tdee_nudge:': 'prefix — handled this week\'s TDEE nudge',
  ta_trophy_case: 'pinned trophies', ta_seen_achievements: 'achievements already celebrated',
  'ta_weight_unit_v1:': 'prefix — kg/lb per exercise',
  // Notification de-duplication — the next account's reminders are its own.
  ta_meal_reminder_notified_today: 'reminder dedupe', ta_eod_reminder_date: 'reminder dedupe',
  ta_evening_reminder_date: 'reminder dedupe', ta_weekly_recap_reminder_sunday: 'reminder dedupe',
  ta_health_alert_notified_today: 'alert dedupe', ta_supplement_reminder_notified_today: 'reminder dedupe',
  ta_workout_reminder_notified_today: 'reminder dedupe', ta_deadletter_notified_v1: 'failed-sync notices shown',
  // Sync cursors and upload queues. A queue left behind would POST under the next account.
  ta_hc_last_sync: 'Health Connect cursor — the next account backfills the window for itself',
  ...UPLOAD_QUEUE_STORAGE,
  // Everything else that is one person's.
  'chat_history_': 'prefix — coach conversations',
  'ta_weather_cache': 'prefix — weather at this person\'s last coordinates',
  'ta-mobile-auth-verifier': 'PKCE verifier of a sign-in in progress; a new sign-in writes its own',
  // sessionStorage
  ta_recommendation_v1: 'sessionStorage: today\'s session recommendation, painted on mount',
  ta_meta_v1: 'sessionStorage: workout meta',
  'ta_coach_pending:': 'prefix — sessionStorage: a coach change awaiting confirmation',
  'ta_scroll:': 'prefix — sessionStorage: scroll positions',
})

/**
 * The persisted Zustand stores that hold account data. **Reset in memory before the keys go**: a
 * store still mounted keeps its state, and the next `set()` — a timer tick, a GPS point — would write
 * the whole of it straight back. Resetting first means anything written afterwards is the empty state.
 */
interface PersistedStore {
  getInitialState(): object
  setState(state: never, replace: true): void
  persist: { clearStorage(): void }
}

const ACCOUNT_STORES: readonly PersistedStore[] = [
  useWorkoutStore,
  useActivityStore,
  useGuidedWalkStore,
  useFitnessTestStore,
  useAutoDetectionStore,
]

export function resetAccountStores(): void {
  for (const store of ACCOUNT_STORES) {
    try {
      store.setState(store.getInitialState() as never, true)
      // Removes the key AND drops a debounced write still pending for it (debounced-storage.ts).
      store.persist.clearStorage()
    } catch { /* best-effort, like every other clear in the sign-out sequence */ }
  }
}

function clearStorage(storage: Storage): void {
  // Collect first: removing while indexing shifts the indices.
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null) keys.push(key)
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(DEVICE_STORAGE, key)) continue
    storage.removeItem(key)
  }
}

/**
 * Clear every browser-storage key that is not a device setting, after resetting the stores that
 * would otherwise write theirs back. Never throws: a failure to wipe must not strand someone signed
 * in (`lib/sign-out.ts`).
 */
export function clearAccountStorage(): void {
  if (typeof window === 'undefined') return
  resetAccountStores()
  try { clearStorage(window.localStorage) } catch { /* storage unavailable */ }
  try { clearStorage(window.sessionStorage) } catch { /* storage unavailable */ }
}
