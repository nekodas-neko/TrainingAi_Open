import { getPool } from "@/lib/data/postgres/client"
import { getRepositoryAsync } from "@/lib/data"

// One row per line, streamed as { domain, row }. Covers every domain named in
// the export plan: programs/styles/schedules, workout sessions + exercise/set
// logs, personal records, body metrics, sleep, mood, day check-ins, food logs
// + items + meal types, supplements + logs, injuries, activity logs,
// oura_daily/tags, goals. Deliberately excludes tokens/credentials tables
// (oura_tokens, push_subscriptions) and internal ops data (error_events,
// feedback_submissions) — this is a takeout of the user's own content, not
// app-internal bookkeeping.
const DIRECT_DOMAINS: { domain: string; table: string }[] = [
  { domain: "programs", table: "programs" },
  { domain: "progression_styles", table: "progression_styles" },
  { domain: "phase_sets", table: "phase_sets" },
  { domain: "personal_records", table: "personal_records" },
  { domain: "body_metrics", table: "body_metrics" },
  { domain: "sleep_sessions", table: "sleep_sessions" },
  { domain: "mood_logs", table: "mood_logs" },
  { domain: "day_checkins", table: "day_checkins" },
  { domain: "food_logs", table: "food_logs" },
  { domain: "food_items", table: "food_items" },
  { domain: "meal_types", table: "meal_types" },
  { domain: "supplements", table: "supplements" },
  { domain: "supplement_logs", table: "supplement_logs" },
  { domain: "injuries", table: "injuries" },
  { domain: "activity_logs", table: "activity_logs" },
  { domain: "oura_daily", table: "oura_daily" },
  { domain: "oura_tags", table: "oura_tags" },
]

const JOINED_DOMAINS: { domain: string; sql: string }[] = [
  {
    domain: "program_sessions",
    sql: `SELECT s.* FROM program_sessions s JOIN programs p ON s.program_id = p.id WHERE p.user_id = $1`,
  },
  {
    domain: "session_exercises",
    sql: `SELECT se.* FROM session_exercises se
          JOIN program_sessions ps ON se.session_id = ps.id
          JOIN programs p ON ps.program_id = p.id
          WHERE p.user_id = $1`,
  },
  {
    domain: "schedules",
    sql: `SELECT sc.* FROM schedules sc JOIN programs p ON sc.program_id = p.id WHERE p.user_id = $1`,
  },
  {
    domain: "schedule_days",
    sql: `SELECT sd.* FROM schedule_days sd
          JOIN schedules sc ON sd.schedule_id = sc.id
          JOIN programs p ON sc.program_id = p.id
          WHERE p.user_id = $1`,
  },
  {
    domain: "style_sets",
    sql: `SELECT ss.* FROM style_sets ss
          JOIN progression_styles pst ON ss.style_id = pst.id
          WHERE pst.user_id = $1`,
  },
  {
    domain: "program_phases",
    sql: `SELECT pp.* FROM program_phases pp
          LEFT JOIN phase_sets ps ON pp.phase_set_id = ps.id
          LEFT JOIN programs p ON pp.program_id = p.id
          WHERE ps.user_id = $1 OR p.user_id = $1`,
  },
  {
    domain: "workout_sessions",
    sql: `SELECT * FROM workout_sessions WHERE user_id = $1 AND deleted_at IS NULL`,
  },
  {
    domain: "exercise_logs",
    sql: `SELECT el.* FROM exercise_logs el
          JOIN workout_sessions ws ON el.workout_session_id = ws.id
          WHERE ws.user_id = $1 AND el.deleted_at IS NULL AND ws.deleted_at IS NULL`,
  },
  {
    domain: "set_logs",
    sql: `SELECT sl.* FROM set_logs sl
          JOIN exercise_logs el ON sl.exercise_log_id = el.id
          JOIN workout_sessions ws ON el.workout_session_id = ws.id
          WHERE ws.user_id = $1 AND sl.deleted_at IS NULL AND el.deleted_at IS NULL AND ws.deleted_at IS NULL`,
  },
]

export async function* exportUserData(userId: string): AsyncGenerator<{ domain: string; row: unknown }> {
  const pool = getPool()

  for (const { domain, table } of DIRECT_DOMAINS) {
    const result = await pool.query(`SELECT * FROM ${table} WHERE user_id = $1`, [userId])
    for (const row of result.rows) yield { domain, row }
  }

  for (const { domain, sql } of JOINED_DOMAINS) {
    const result = await pool.query(sql, [userId])
    for (const row of result.rows) yield { domain, row }
  }

  const repo = await getRepositoryAsync()
  const goals = await repo.getUserGoals(userId)
  yield { domain: "goals", row: goals }
}
