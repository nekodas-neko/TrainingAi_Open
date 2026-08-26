import { z } from 'zod'
import { isCalendarDate } from '../date-utils'

// The single canonical list of outbox domains. The push envelope enum below AND
// the local-store `PendingMutation['domain']` type (lib/local-store/types.ts)
// both derive from this array, so the two can never drift — a new domain used at
// a `queueMutation` call site that isn't listed here is a compile error at the
// call site, and one listed here but absent from the enum can't happen. This is
// the structural guard against D-1 (the `food_items` domain shipped with a
// working adapter branch but a missing envelope enum entry, so every new-food
// log on the APK was silently dropped by the push route).
export const SYNCED_MUTATION_DOMAINS = [
  'body_metrics', 'mood_logs', 'food_logs', 'food_items', 'supplement_logs',
  'injuries', 'supplements', 'activity_logs', 'fitness_tests', 'prescribed_run',
  'workout_log', 'day_checkins', 'session_rpe', 'complete_workout', 'saved_meals',
  'oura_daily_summary', 'oura_daily_derived', 'sleep_session', 'plan_meal_answers',
  // Q-519. Distinct from `sleep_session`, which is the BLE rollup backing up a whole night it
  // measured, keyed on `ouraId` and written at `oura_ble` rank. This one is a user answering a
  // question about a night the ring did not observe: it targets an existing row by date and sets
  // one column that no window, duration or efficiency is ever derived from.
  'manual_bedtime',
] as const

export type SyncedMutationDomain = (typeof SYNCED_MUTATION_DOMAINS)[number]

// Envelope for one outbox mutation pushed from the on-device store.
// `id` is the client's mutations_outbox row id — optional so pre-v13 clients
// (which push without it) keep working. The server only echoes it back in
// per-item results; it is never trusted for anything else.
export const MutationSchema = z.object({
  id:      z.string().max(64).optional(),
  domain:  z.enum(SYNCED_MUTATION_DOMAINS),
  // Both separators: the client fills date params from localDateString(), which emits
  // slashes — a dash-only regex rejects every real request before the handler runs (Q-130).
  // ...and `.refine(isCalendarDate)` because the regex bounds the SHAPE only: `2026-13-45` and
  // `2026-02-31` pass it, reach the driver as `[pg 22008]`, and the push route echoes the whole
  // failed INSERT back to the caller (Q-496, measured). A mutation that fails here is dropped and
  // quarantined by the route's existing per-item handling rather than wedging the queue.
  date:    z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).refine(isCalendarDate, 'Not a real calendar date'),
  payload: z.record(z.string(), z.unknown()),
})

export type PushMutation = z.infer<typeof MutationSchema>
