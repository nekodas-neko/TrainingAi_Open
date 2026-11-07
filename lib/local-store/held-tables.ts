// #3654. Its own module so `sqlite-backend` can import it without importing `./index`, which the
// local-store tests mock.
/** The local tables `heldUpdatedAt` reads, each with the key the pull matches rows on. */
export const HELD_TABLE_KEYS = {
  body_metrics: 'date',
  mood_logs: 'log_date',
  sleep_sessions: 'id',
  workout_sessions: 'id',
  activity_logs: 'id',
  fitness_tests: 'id',
  prescribed_runs: 'id',
  food_logs: 'id',
  food_items: 'id',
  supplements: 'id',
  supplement_logs: 'id',
  injuries: 'id',
  exercise_logs: 'id',
  set_logs: 'id',
  day_checkins: "log_date || '|' || phase",
  meal_plans: 'id',
  plan_meal_answers: 'id',
  oura_daily: 'day',
  local_programs: 'id',
  local_progression_styles: 'id',
} as const;
export type HeldTable = keyof typeof HELD_TABLE_KEYS;

/**
 * Columns a pull fills on a held row even at an EQUAL `updated_at` (`applyDeltaBody`): a row pulled by
 * an older device schema lacks them, and a re-send fills them. Such a re-send changes the device, so
 * `heldUpdatedAt` reports which of them are empty, as `[local column, pulled field]`.
 */
export const HELD_FILL_COLUMNS: Partial<Record<HeldTable, readonly (readonly [string, string])[]>> = {
  sleep_sessions: [
    ['sleep_start', 'sleepStart'],
    ['oura_sleep_type', 'ouraSleepType'],
    ['onset_at', 'onsetAt'],
    ['source_algorithm_version', 'sourceAlgorithmVersion'],
  ],
};

/** What the device holds of a pulled row: its stamp, and which fill columns it lacks. */
export interface HeldRow { updatedAt: string | null; emptyFields: string[] }
