#!/usr/bin/env node
// Measure what happens when C users sync at once, against the pool size production runs.
//
// WHAT THIS MEASURES, precisely — read before quoting a number from it.
// `getSyncDelta` (lib/data/postgres/adapter.ts) issues its per-domain reads inside ONE
// `Promise.all`. This replays that shape as raw SQL against the same table set, so it measures the
// thing in question — **connection demand per sync × concurrent syncs against a fixed pool** — and
// deliberately not drizzle's overhead, Next's request handling, or network latency. A number from
// here is a floor on contention, not a prediction of end-to-end response time.
//
// The arithmetic that motivates it: one sync needs ~21 connections; the pool is `max: 10`
// (lib/data/postgres/client.ts). A single user already over-subscribes it.
//
// LOCAL ONLY — same guard as the seeder.
//
// Usage: DATABASE_URL=... node scripts/load-test/sync-fanout.js [concurrency] [poolMax]

const { Pool } = require('pg')

const WINDOW_DAYS = 90

// One entry per domain the sync delta pulls. Kept as raw SQL so this file stays runnable with
// plain node — the point is the connection demand, not the exact column list.
const FANOUT = [
  ['programs', `SELECT * FROM programs WHERE user_id = $1 AND updated_at > $2`],
  ['progression_styles', `SELECT * FROM progression_styles WHERE user_id = $1 AND updated_at > $2`],
  ['body_metrics', `SELECT * FROM body_metrics WHERE user_id = $1 AND updated_at > $2`],
  ['sleep_sessions', `SELECT * FROM sleep_sessions WHERE user_id = $1 AND updated_at > $2`],
  ['mood_logs', `SELECT * FROM mood_logs WHERE user_id = $1 AND updated_at > $2`],
  ['activity_logs', `SELECT * FROM activity_logs WHERE user_id = $1 AND updated_at > $2`],
  ['fitness_tests', `SELECT * FROM fitness_tests WHERE user_id = $1 AND created_at > $2`],
  ['prescribed_runs', `SELECT * FROM prescribed_runs WHERE user_id = $1 AND created_at > $2`],
  ['workout_sessions', `SELECT * FROM workout_sessions WHERE user_id = $1 AND started_at > $2`],
  ['exercise_logs', `SELECT el.* FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = $1 AND el.logged_at > $2`],
  ['set_logs', `SELECT sl.* FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = $1 AND sl.updated_at > $2`],
  ['personal_records', `SELECT * FROM personal_records WHERE user_id = $1`],
  ['supplements', `SELECT * FROM supplements WHERE user_id = $1`],
  ['supplement_logs', `SELECT * FROM supplement_logs WHERE user_id = $1 AND created_at > $2`],
  ['food_logs', `SELECT * FROM food_logs WHERE user_id = $1 AND updated_at > $2`],
  ['food_items', `SELECT * FROM food_items WHERE user_id = $1`],
  ['meal_types', `SELECT * FROM meal_types WHERE user_id = $1`],
  ['injuries', `SELECT * FROM injuries WHERE user_id = $1`],
  ['day_checkins', `SELECT * FROM day_checkins WHERE user_id = $1 AND updated_at > $2`],
  ['oura_daily', `SELECT * FROM oura_daily WHERE user_id = $1 AND synced_at > $2`],
  ['oura_heartrate', `SELECT * FROM oura_heartrate WHERE user_id = $1 AND timestamp > $2 LIMIT 500`],
]

function assertLocal(url) {
  if (!url) throw new Error('DATABASE_URL is not set')
  const local = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('host=/')
  if (!local) throw new Error('REFUSING to load-test a non-local database.')
}

function pct(sorted, p) {
  if (!sorted.length) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

// SERIAL variant: the same 21 reads on ONE connection, held for the duration. Included because the
// per-query timings say the entire fan-out is ~23 ms of actual work — so the parallelism buys very
// little for a single user while costing 21 connections. This measures that trade directly.
async function oneSyncSerial(pool, userId, since) {
  const t0 = Date.now()
  const w0 = Date.now()
  const client = await pool.connect()
  const wait = Date.now() - w0
  const failures = []
  try {
    for (const [name, sql] of FANOUT) {
      try {
        await client.query(sql, sql.includes('$2') ? [userId, since] : [userId])
      } catch (err) { failures.push({ name, err: err.message.slice(0, 80) }) }
    }
  } finally { client.release() }
  return { ms: Date.now() - t0, maxWaitMs: wait, failures }
}

// CHUNKED variant: the fan-out in N batches, so connection demand is N instead of 21 while most of
// the parallelism survives. Added 2026-08-16 once the owner measured Railway RTT at p50 0.86 ms /
// p95 1.22 ms — low enough that trading round-trips for connections is worth measuring rather than
// arguing about. `RTT_MS` simulates that network cost, which the local unix socket does not have.
async function oneSyncChunked(pool, userId, since, chunkCount, rttMs) {
  const t0 = Date.now()
  const waits = []
  const failures = []
  const size = Math.ceil(FANOUT.length / chunkCount)
  const batches = []
  for (let i = 0; i < FANOUT.length; i += size) batches.push(FANOUT.slice(i, i + size))
  // Batches run in sequence; the queries WITHIN a batch run in parallel on their own connections.
  // That is what "chunked" has to mean — an earlier draft ran them serially inside the batch, which
  // is just serial with extra connection churn, and measured worse than serial for that reason.
  for (const batch of batches) {
    await Promise.all(batch.map(async ([name, sql]) => {
      const w0 = Date.now()
      const client = await pool.connect()
      waits.push(Date.now() - w0)
      try {
        if (rttMs > 0) await new Promise(r => setTimeout(r, rttMs))   // simulate the network hop
        await client.query(sql, sql.includes('$2') ? [userId, since] : [userId])
      } catch (err) { failures.push({ name, err: err.message.slice(0, 80) }) }
      finally { client.release() }
    }))
  }
  return { ms: Date.now() - t0, maxWaitMs: Math.max(...waits), failures }
}

async function oneSync(pool, userId, since) {
  const t0 = Date.now()
  const waits = []
  const results = await Promise.all(FANOUT.map(async ([name, sql]) => {
    const w0 = Date.now()
    const client = await pool.connect()        // this is where pool starvation shows up
    waits.push(Date.now() - w0)
    try {
      const needsSince = sql.includes('$2')
      await client.query(sql, needsSince ? [userId, since] : [userId])
      return { name, ok: true }
    } catch (err) {
      return { name, ok: false, err: err.message.slice(0, 80) }
    } finally {
      client.release()
    }
  }))
  return { ms: Date.now() - t0, maxWaitMs: Math.max(...waits), failures: results.filter(r => !r.ok) }
}

async function main() {
  const url = process.env.DATABASE_URL
  assertLocal(url)
  const concurrency = Number(process.argv[2] || 10)
  const poolMax = Number(process.argv[3] || 10)

  let userIds
  try {
    userIds = JSON.parse(require('fs').readFileSync('/tmp/loadtest-users.json', 'utf8'))
  } catch {
    throw new Error('run scripts/load-test/seed-users.js first')
  }

  const pool = new Pool({ connectionString: url, max: poolMax, connectionTimeoutMillis: 15_000 })
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)

  // Warm the pool and the plan cache so the first run is not measuring cold start.
  await oneSync(pool, userIds[0], since)

  const users = Array.from({ length: concurrency }, (_, i) => userIds[i % userIds.length])
  const serial = process.env.SERIAL === '1'
  const chunks = Number(process.env.CHUNKS || 0)
  const rttMs = Number(process.env.RTT_MS || 0)
  const runner = chunks > 0
    ? (p, u, si) => oneSyncChunked(p, u, si, chunks, rttMs)
    : serial ? oneSyncSerial : oneSync
  const t0 = Date.now()
  const runs = await Promise.all(users.map(u => runner(pool, u, since)))
  const wall = Date.now() - t0

  const times = runs.map(r => r.ms).sort((a, b) => a - b)
  const waitsMax = Math.max(...runs.map(r => r.maxWaitMs))
  const failures = runs.flatMap(r => r.failures)

  const perSync = chunks > 0 ? chunks : serial ? 1 : FANOUT.length
  console.log(`\nconcurrency=${concurrency}  poolMax=${poolMax}  queriesPerSync=${FANOUT.length}  mode=${chunks > 0 ? `CHUNKED x${chunks} (rtt ${rttMs}ms)` : serial ? 'SERIAL (1 conn/sync)' : 'PARALLEL (21 conn/sync)'}`)
  console.log(`  connection demand : ${concurrency * perSync} vs pool of ${poolMax}  (${((concurrency * perSync) / poolMax).toFixed(1)}x over-subscribed)`)
  console.log(`  wall clock        : ${wall} ms for all ${concurrency}`)
  console.log(`  per-sync p50/p95  : ${pct(times, 50)} / ${pct(times, 95)} ms   (min ${times[0]}, max ${times[times.length - 1]})`)
  console.log(`  worst pool wait   : ${waitsMax} ms`)
  console.log(`  failures          : ${failures.length}${failures.length ? '  e.g. ' + failures[0].name + ': ' + failures[0].err : ''}`)

  await pool.end()
}

main().catch(err => { console.error(err.message); process.exit(1) })
