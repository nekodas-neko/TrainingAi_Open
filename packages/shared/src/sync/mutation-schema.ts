import { z } from 'zod'

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
  date:    z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  payload: z.record(z.string(), z.unknown()),
})

export type PushMutation = z.infer<typeof MutationSchema>
