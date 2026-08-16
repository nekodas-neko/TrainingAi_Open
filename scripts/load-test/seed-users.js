#!/usr/bin/env node
// Seed N synthetic users into the LOCAL dev database, each carrying a realistic volume of the
// tables `getSyncDelta` actually reads. Existence rationale and results:
// docs/reviews/2026-08-16-multi-user-load-test.md
//
// LOCAL ONLY. Refuses to run against anything that is not localhost/127.0.0.1/a unix socket —
// this writes thousands of rows and must never touch production.
//
// Usage: DATABASE_URL=... node scripts/load-test/seed-users.js [userCount]
//   userCount defaults to 10. Idempotent by prefix: re-running drops and re-creates
//   every user whose email starts with loadtest- .

const { Pool } = require('pg')
const crypto = require('crypto')

const EMAIL_PREFIX = 'loadtest-'

// Per-user volumes, chosen to match the owner's real production profile so the measurement
// generalises: ~50 workout sessions / ~350 exercise logs / ~1,000 set logs / ~45 sleep rows over
// ~90 days, plus the HR series that dominates row count in production.
const PER_USER = {
  workoutSessions: 50,
  exerciseLogsPerSession: 7,
  setLogsPerExercise: 3,
  sleepSessions: 45,
  bodyMetrics: 90,
  moodLogs: 60,
  activityLogs: 45,
  heartrateSamples: 2000,
}

function assertLocal(url) {
  if (!url) throw new Error('DATABASE_URL is not set')
  const local = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('host=/')
  if (!local) {
    throw new Error(`REFUSING to seed a non-local database.\n  DATABASE_URL=${url.replace(/:[^:@/]*@/, ':***@')}`)
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  assertLocal(url)
  const userCount = Number(process.argv[2] || 10)
  if (!Number.isInteger(userCount) || userCount < 1 || userCount > 500) {
    throw new Error('userCount must be an integer 1..500')
  }

  const pool = new Pool({ connectionString: url, max: 4 })
  const t0 = Date.now()

  console.log(`[seed] wiping previous ${EMAIL_PREFIX}* users…`)
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [EMAIL_PREFIX + '%'])

  console.log(`[seed] creating ${userCount} users…`)
  const userIds = []
  for (let u = 0; u < userCount; u++) {
    const id = crypto.randomUUID()
    userIds.push(id)
    await pool.query(
      `INSERT INTO users (id, email, name, timezone) VALUES ($1, $2, $3, 'Australia/Brisbane')`,
      [id, `${EMAIL_PREFIX}${u}@local.test`, `Load Test ${u}`],
    )
  }

  const day = i => new Date(Date.now() - i * 86_400_000)

  for (let u = 0; u < userIds.length; u++) {
    const uid = userIds[u]

    // workout_sessions -> exercise_logs -> set_logs, the deepest chain the sync delta walks
    for (let w = 0; w < PER_USER.workoutSessions; w++) {
      const startedAt = day(w * 2)
      const { rows: [ws] } = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [uid, ['Push', 'Pull', 'Legs', 'Upper', 'Lower'][w % 5], startedAt, startedAt],
      )
      for (let e = 0; e < PER_USER.exerciseLogsPerSession; e++) {
        const { rows: [el] } = await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, avg_reps, muscle_groups, logged_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [ws.id, `Exercise ${e}`, 80 + e, 1500 + e * 10, 8, ['chest', 'triceps'], startedAt],
        )
        for (let s = 0; s < PER_USER.setLogsPerExercise; s++) {
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, rpe, intensity_pct)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [el.id, s + 1, 60 + s * 5, 8, 8, 75],
          )
        }
      }
    }

    for (let i = 0; i < PER_USER.sleepSessions; i++) {
      await pool.query(
        `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, deep_sleep_hours, rem_sleep_hours, avg_heart_rate)
         VALUES ($1, $2, $3, $4, 7.5, 1.2, 1.8, 58) ON CONFLICT DO NOTHING`,
        [uid, day(i).toISOString().slice(0, 10),
         new Date(day(i).getTime() - 8 * 3_600_000), day(i)],
      )
    }
    for (let i = 0; i < PER_USER.bodyMetrics; i++) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, steps, calories) VALUES ($1, $2, 70, 8000, 2000)
         ON CONFLICT DO NOTHING`,
        [uid, day(i).toISOString().slice(0, 10)],
      )
    }
    for (let i = 0; i < PER_USER.moodLogs; i++) {
      await pool.query(
        `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality) VALUES ($1, $2, 'ok', 'ok') ON CONFLICT DO NOTHING`,
        [uid, day(i).toISOString().slice(0, 10)],
      )
    }
    for (let i = 0; i < PER_USER.activityLogs; i++) {
      await pool.query(
        `INSERT INTO activity_logs (user_id, date, activity_type, title, duration_min, distance_km)
         VALUES ($1, $2, 'walk', 'Load test walk', 35, 3.2)`,
        [uid, day(i).toISOString().slice(0, 10)],
      )
    }

    // The HR series dominates row count in production (49k rows for one user). Batched, since
    // per-row inserts here would take minutes per user.
    const CHUNK = 500
    for (let base = 0; base < PER_USER.heartrateSamples; base += CHUNK) {
      const vals = []
      const params = []
      for (let i = 0; i < CHUNK && base + i < PER_USER.heartrateSamples; i++) {
        const n = params.length
        vals.push(`($${n + 1}, $${n + 2}, $${n + 3}, 'oura_ble')`)
        params.push(uid, new Date(Date.now() - (base + i) * 60_000), 60 + ((base + i) % 40))
      }
      await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${vals.join(',')}
         ON CONFLICT DO NOTHING`,
        params,
      )
    }

    process.stdout.write(`\r[seed] user ${u + 1}/${userIds.length} done`)
  }

  console.log(`\n[seed] complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM users WHERE email LIKE $1) AS users,
            (SELECT count(*) FROM set_logs) AS set_logs,
            (SELECT count(*) FROM oura_heartrate) AS hr`,
    [EMAIL_PREFIX + '%'],
  )
  console.log('[seed]', rows[0])
  console.log('[seed] user ids written to /tmp/loadtest-users.json')
  require('fs').writeFileSync('/tmp/loadtest-users.json', JSON.stringify(userIds))
  await pool.end()
}

main().catch(err => { console.error(err.message); process.exit(1) })
