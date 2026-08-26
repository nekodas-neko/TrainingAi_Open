/**
 * Q-288: `/api/export` covered **26 of 82 tables and presented as complete**. An incomplete export
 * is worse than none, because nothing signals the omission — and it is the artefact a
 * data-portability claim rests on.
 *
 * The old shape was two hand-maintained arrays, so every table added since the export was written
 * was absent by accident: every computed Oura score, the personal baselines, the user's whole AI
 * conversation history, meal plans, saved meals, fitness tests, running plans, and their own
 * profile row. Hand-extending those arrays would reproduce exactly the drift being fixed.
 *
 * So this file is **exhaustive by construction**: every base table is either in `EXPORTED` with a
 * scope, or in `EXCLUDED` with a written reason. `scripts/check-export-coverage.js` fails the
 * Custom Rules job when a `pgTable` in `schema.ts` is in neither — a new table cannot be forgotten,
 * only classified.
 *
 * Deliberately NOT driven from `scripts/generate-claude-ro-views.js`, whose classification is the
 * closest thing that already exists: its views are scoped to ONE fixed owner via
 * `app.claude_ro_owner`, and this export is scoped to whoever is asking. Coupling a
 * per-request user export to the security-critical read-only view surface would put the two on one
 * blast radius for no shared behaviour.
 */

/** `t` is the table alias. `$1` is the requesting user's id. */
export type ExportScope =
  | { kind: 'user_id' }
  | { kind: 'own_row' }
  | { kind: 'via'; predicate: string }

export type ExclusionCategory = 'credentials' | 'catalogue' | 'ops' | 'raw-frames' | 'third-party'
export interface Exclusion { category: ExclusionCategory; reason: string }

/** Soft-delete columns to filter — a takeout must not resurrect content the user deleted.
 *  Hand-listing this was wrong on the first attempt in BOTH directions (two tables invented,
 *  thirteen missed), so `check-export-coverage.js` derives the truth from schema.ts and fails on
 *  a mismatch rather than trusting this list. Every entry is `deleted_at`; the column name stays
 *  explicit so a table that ever uses a different one needs no new shape. */
export const SOFT_DELETED: Record<string, string> = {
  activity_logs: 'deleted_at',
  body_metrics: 'deleted_at',
  day_checkins: 'deleted_at',
  exercise_logs: 'deleted_at',
  fitness_tests: 'deleted_at',
  food_logs: 'deleted_at',
  injuries: 'deleted_at',
  meal_plans: 'deleted_at',
  meal_types: 'deleted_at',
  mood_logs: 'deleted_at',
  plan_meal_answers: 'deleted_at',
  prescribed_runs: 'deleted_at',
  set_logs: 'deleted_at',
  supplement_logs: 'deleted_at',
  supplements: 'deleted_at',
  workout_sessions: 'deleted_at',
}

export const EXPORTED: Record<string, ExportScope> = {
  // ── The user's own row. `users.password_hash` and friends are stripped by WITHHELD_COLUMNS.
  users: { kind: 'own_row' },

  // ── Directly user-scoped ────────────────────────────────────────────────────
  activity_logs: { kind: 'user_id' },
  ai_health_insights: { kind: 'user_id' },
  body_battery_daily: { kind: 'user_id' },
  body_metrics: { kind: 'user_id' },
  coach_changes: { kind: 'user_id' },
  coach_messages: { kind: 'user_id' },
  coach_threads: { kind: 'user_id' },
  daily_zone_minutes: { kind: 'user_id' },
  day_checkins: { kind: 'user_id' },
  exercise_estimates: { kind: 'user_id' },
  fitness_tests: { kind: 'user_id' },
  food_items: { kind: 'user_id' },
  food_logs: { kind: 'user_id' },
  goal_recommendations: { kind: 'user_id' },
  injuries: { kind: 'user_id' },
  meal_plans: { kind: 'user_id' },
  meal_types: { kind: 'user_id' },
  measured_rmr: { kind: 'user_id' },
  mood_logs: { kind: 'user_id' },
  nutrition_targets: { kind: 'user_id' },
  oura_daily: { kind: 'user_id' },
  oura_daily_derived: { kind: 'user_id' },
  oura_daily_summary: { kind: 'user_id' },
  oura_daytime_hrv_model: { kind: 'user_id' },
  oura_daytime_stress_buckets: { kind: 'user_id' },
  oura_tags: { kind: 'user_id' },
  oura_workouts: { kind: 'user_id' },
  personal_records: { kind: 'user_id' },
  phase_sets: { kind: 'user_id' },
  plan_meal_answers: { kind: 'user_id' },
  prescribed_runs: { kind: 'user_id' },
  programs: { kind: 'user_id' },
  progression_styles: { kind: 'user_id' },
  running_plans: { kind: 'user_id' },
  saved_meals: { kind: 'user_id' },
  scale_raw_samples: { kind: 'user_id' },
  season_results: { kind: 'user_id' },
  session_periodization: { kind: 'user_id' },
  set_hr_stats: { kind: 'user_id' },
  sleep_sessions: { kind: 'user_id' },
  step_live_windows: { kind: 'user_id' },
  supplement_logs: { kind: 'user_id' },
  supplements: { kind: 'user_id' },
  user_dietary_restrictions: { kind: 'user_id' },
  user_stats: { kind: 'user_id' },
  workout_hr_stats: { kind: 'user_id' },
  workout_sessions: { kind: 'user_id' },

  // The user's own heart-rate measurements. Large (33 MB + 13 MB in production) and included
  // anyway: these are readings taken from their body, which is the least omittable thing in a
  // health takeout. Safe to include only because the reads below are now paginated.
  // Colmi R09 ring, learning mode (PS-8). The user's own health data, so it exports like any
  // other — being quarantined from SCORING says nothing about whether it is theirs to take.
  colmi_readings: { kind: 'user_id' },
  colmi_sleep_segments: { kind: 'user_id' },
  oura_heartrate: { kind: 'user_id' },
  rr_intervals: { kind: 'user_id' },

  // ── Reachable only through a parent. Predicates mirror generate-claude-ro-views.js's `VIA`,
  //    which is where these FK paths were worked out and commented. ────────────
  exercise_logs: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.workout_sessions p WHERE p.id = t.workout_session_id AND p.user_id = $1)' },
  set_logs: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.exercise_logs e JOIN public.workout_sessions p ON p.id = e.workout_session_id WHERE e.id = t.exercise_log_id AND p.user_id = $1)' },
  program_sessions: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.programs p WHERE p.id = t.program_id AND p.user_id = $1)' },
  session_exercises: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.program_sessions ps JOIN public.programs p ON p.id = ps.program_id WHERE ps.id = t.session_id AND p.user_id = $1)' },
  schedules: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.programs p WHERE p.id = t.program_id AND p.user_id = $1)' },
  schedule_days: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.schedules s JOIN public.programs p ON p.id = s.program_id WHERE s.id = t.schedule_id AND p.user_id = $1)' },
  style_sets: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.progression_styles ps WHERE ps.id = t.style_id AND ps.user_id = $1)' },
  program_volume_targets: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.programs p WHERE p.id = t.program_id AND p.user_id = $1)' },
  saved_meal_items: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.saved_meals sm WHERE sm.id = t.saved_meal_id AND sm.user_id = $1)' },
  // BF-11e. Scoped through the meal, matching `saved_meal_items` — both FKs lead to a user, and
  // taking the same path keeps one rule for the two tables hanging off `saved_meals`.
  saved_meal_meal_types: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.saved_meals sm WHERE sm.id = t.saved_meal_id AND sm.user_id = $1)' },
  meal_plan_variants: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.meal_plans mp WHERE mp.id = t.meal_plan_id AND mp.user_id = $1)' },
  meal_plan_meals: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.meal_plan_variants v JOIN public.meal_plans mp ON mp.id = v.meal_plan_id WHERE v.id = t.variant_id AND mp.user_id = $1)' },
  // Both arms, for the reason the generator documents at length: `program_id` is nullable and the
  // modern write path sets only `phase_set_id`, so a program_id-only predicate hides every row.
  program_phases: { kind: 'via', predicate: 'EXISTS (SELECT 1 FROM public.phase_sets ps WHERE ps.id = t.phase_set_id AND ps.user_id = $1) OR EXISTS (SELECT 1 FROM public.programs p WHERE p.id = t.program_id AND p.user_id = $1)' },
}

/** Columns never written to a takeout, even from an exported table. */
export const WITHHELD_COLUMNS: Record<string, string[]> = {
  users: ['password_hash'],
}

export const EXCLUDED: Record<string, Exclusion> = {
  // ── Credentials. Exporting these hands the reader a working key. ────────────
  oura_tokens: { category: 'credentials', reason: 'OAuth/PAT credentials and the webhook signing key' },

  // ── Shared catalogue. Seed data the app ships, not anything the user created. ─
  activity_types: { category: 'catalogue', reason: 'shipped catalogue of activity types' },
  dietary_restrictions: { category: 'catalogue', reason: 'shipped catalogue; the user\'s picks are in user_dietary_restrictions, which IS exported' },
  exercise_library: { category: 'catalogue', reason: 'shipped exercise catalogue' },
  exercise_media: { category: 'catalogue', reason: 'shipped exercise media' },
  exercise_gif_cache: { category: 'catalogue', reason: 'generated media cache, keyed by exercise not by user' },
  seasons: { category: 'catalogue', reason: 'global season definitions; the user\'s results are in season_results, which IS exported' },

  // ── App-internal bookkeeping. Not the user's content, and meaningless outside this database. ─
  ai_call_log: { category: 'ops', reason: 'token/latency accounting, no user content' },
  app_load_metrics: { category: 'ops', reason: 'page-load timing telemetry, pruned at 14 days' },
  applied_mutations: { category: 'ops', reason: 'sync idempotency ledger' },
  db_query_log: { category: 'ops', reason: 'admin SQL audit trail' },
  error_events: { category: 'ops', reason: 'fault telemetry, pruned at 30 days' },
  feedback_submissions: { category: 'ops', reason: 'support tickets, not part of the user\'s record' },
  oura_ble_battery_poll: { category: 'ops', reason: 'ring battery poll bookkeeping' },
  oura_ble_clock_anchors: { category: 'ops', reason: 'ring-epoch↔UTC anchors; decoder state' },
  oura_ble_rekey_declarations: { category: 'ops', reason: 'ring re-key bookkeeping' },
  oura_bucket: { category: 'ops', reason: 'rollup working set' },
  oura_redecode_jobs: { category: 'ops', reason: 'decoder backfill job state' },
  oura_rollup_state: { category: 'ops', reason: 'rollup cursor' },
  rate_limits: { category: 'ops', reason: 'request-timing keys that embed other users\' ids' },
  schema_migrations: { category: 'ops', reason: 'migration ledger' },

  // ── Raw device frames. Machine input to the rollup, not user-meaningful content, and by far the
  //    largest tables (oura_raw_samples alone is 58 MB, and its rows are hex blobs). Everything
  //    they encode reaches the user through the decoded tables above, all of which ARE exported.
  //    Written down as a deliberate exclusion rather than absent by accident, per the entry.
  oura_raw_samples: { category: 'raw-frames', reason: 'undecoded BLE frames (58 MB of hex); the decoded values are exported' },
  oura_raw_packed: { category: 'raw-frames', reason: 'packed archival blobs of the same frames' },
  oura_accel_chunks: { category: 'raw-frames', reason: 'raw accelerometer chunks' },

  // ── Jointly about another account. ───────────────────────────────────────────
  friendships: { category: 'third-party', reason: 'each row is also the other account\'s relationship record, and the counterparty is an opaque uuid here' },
  invited_emails: { category: 'third-party', reason: 'other people\'s email addresses' },
}
