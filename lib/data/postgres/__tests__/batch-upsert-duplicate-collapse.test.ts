// Q-280 — the same hazard Q-214 fixed in one place, proven against a real Postgres at the sites
// that never got it.
//
// Postgres aborts an entire command whose VALUES list hits the same ON CONFLICT row twice
// ("ON CONFLICT DO UPDATE command cannot affect row a second time", SQLSTATE 21000). It is not a
// partial failure: nothing in the batch lands. `error_events` recorded 5,771 hits of it on
// `POST /api/hr-ingest`, each discarding up to 5,000 heart-rate points, until Q-214.
//
// The first test proves the hazard is real rather than assumed — it is the thing every other test
// here says has been fixed. The rest drive the real write functions with a deliberate duplicate.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000280001'

describe.skipIf(!canRun)('batch upserts collapse duplicates on the conflict target (Q-280)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let oura: typeof import('@/lib/data/postgres/slices/oura')
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    oura = await import('@/lib/data/postgres/slices/oura')
    pool = getPool(); db = await getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, `batch-collapse-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    for (const t of ['oura_heartrate', 'oura_bucket', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  // The premise. If this ever stops throwing, every collapse below is dead weight and should go.
  it('Postgres really does reject the WHOLE batch on a repeated conflict target', async () => {
    const at = new Date('2026-03-01T00:00:00Z')
    await expect(pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm) VALUES ($1,$2,60), ($1,$2,61)
       ON CONFLICT (user_id, timestamp) DO UPDATE SET bpm = excluded.bpm`,
      [USER, at],
    )).rejects.toMatchObject({ code: '21000' })
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_heartrate WHERE user_id = $1 AND timestamp = $2`, [USER, at])
    expect(rows[0].n).toBe(0) // not "one of them landed" — nothing did
  })

  it('upsertOuraHeartrate keeps the batch and takes the last value', async () => {
    const at = new Date('2026-03-02T00:00:00Z')
    const other = new Date('2026-03-02T00:00:05Z')
    await oura.upsertOuraHeartrate(db, USER, [
      { timestamp: at, bpm: 60, source: 'ble' },
      { timestamp: other, bpm: 99, source: 'ble' }, // the sibling a 21000 would have taken down
      { timestamp: at, bpm: 61, source: 'ble' },
    ])
    const { rows } = await pool.query(
      `SELECT timestamp, bpm FROM oura_heartrate WHERE user_id = $1 AND timestamp >= $2 ORDER BY timestamp`,
      [USER, at])
    expect(rows.map(r => r.bpm)).toEqual([61, 99])
  })

  it('upsertOuraBucket keeps the batch, and does not merge distinct tiers', async () => {
    const bucket = (tier: string, ms: number, hrMean: number) => ({
      tier, bucketStartMs: ms, bucketStartDs: ms / 100, localDate: '2026-03-03',
      hrMean, hrMin: null, hrMax: null, hrvRmssdMs: null, spo2Pct: null, perfusionIndex: null,
      skinTempC: null, metMean: null, metMinutes: null, motionMad: null, ibiMs: null, sampleCount: 1,
    })
    const ms = Date.UTC(2026, 2, 3)
    await oura.upsertOuraBucket(db, USER, [
      bucket('5m', ms, 50),
      bucket('1h', ms, 55), // same instant, different tier — a distinct row, must survive
      bucket('5m', ms, 51),
    ])
    const { rows } = await pool.query(
      `SELECT tier, hr_mean FROM oura_bucket WHERE user_id = $1 ORDER BY tier`, [USER])
    expect(rows).toEqual([{ tier: '1h', hr_mean: 55 }, { tier: '5m', hr_mean: 51 }])
  })

  // The rank-merge arm keeps a stored value when the incoming one is NULL, so the collapse must
  // too — plain last-wins would let the second fragment of a re-segmented night blank the first's
  // HRV, which is a silent loss rather than a visible failure.
  it('upsertOuraSleep collapses a repeated sleep_start without dropping fields', async () => {
    const start = new Date('2026-03-03T13:00:00Z')
    const end = new Date('2026-03-03T21:00:00Z')
    await oura.upsertOuraSleep(db, USER, [
      { date: '2026-03-04', sleepStart: start, sleepEnd: end, durationHours: 8, averageHrvMs: 55 },
      { date: '2026-03-04', sleepStart: start, sleepEnd: end, durationHours: 7.5, averageHrvMs: null },
    ], 'oura_ble')
    const { rows } = await pool.query(
      `SELECT duration_hours, average_hrv_ms FROM sleep_sessions WHERE user_id = $1`, [USER])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].duration_hours)).toBe(7.5)  // later non-null wins
    expect(rows[0].average_hrv_ms).toBe(55)           // later null does not erase
  })

  it('upsertBodyMetrics collapses a repeated date without dropping fields', async () => {
    await repo.upsertBodyMetrics(USER, [
      { date: '2026-03-05', weightKg: 80, steps: 9000 },
      { date: '2026-03-05', weightKg: 81 },
    ], 'manual')
    const { rows } = await pool.query(
      `SELECT weight_kg, steps FROM body_metrics WHERE user_id = $1 AND date = '2026-03-05'`, [USER])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].weight_kg)).toBe(81)
    expect(rows[0].steps).toBe(9000) // the field the second row did not carry
  })

  it('logSets keeps the exercise when a payload repeats a set_number', async () => {
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload(
      USER,
      { sessionName: 'Batch Collapse', exercise: 'Collapse Bench', weights: [100], sets: 1, reps: [5] } as never,
      'Australia/Brisbane',
    )
    const { rows: [log] } = await pool.query(
      `SELECT el.id FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = 'Collapse Bench'`, [USER])
    await repo.logSets(log.id, [
      { setNumber: 2, weightKg: 100, reps: 5, useFor1rm: true },
      { setNumber: 3, weightKg: 105, reps: 5, useFor1rm: true }, // would be lost with the batch
      { setNumber: 2, weightKg: 102, reps: 4, useFor1rm: true },
    ] as never)
    const { rows } = await pool.query(
      `SELECT set_number, weight_kg FROM set_logs WHERE exercise_log_id = $1 AND set_number >= 2
        ORDER BY set_number`, [log.id])
    expect(rows.map(r => Number(r.weight_kg))).toEqual([102, 105])
  })

  // `logSets` zips `.returning()` against its input by index, so the array it inserts and the array
  // it zips have to be the SAME array. Collapsing inline shifts every set after the first duplicate
  // onto the wrong id — a quieter bug than the 21000 it was fixing.
  it('logSets returns ids that belong to the sets it actually wrote', async () => {
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload(
      USER,
      { sessionName: 'Batch Collapse', exercise: 'Collapse Row', weights: [60], sets: 1, reps: [5] } as never,
      'Australia/Brisbane',
    )
    const { rows: [log] } = await pool.query(
      `SELECT el.id FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = 'Collapse Row'`, [USER])
    const returned = await repo.logSets(log.id, [
      { setNumber: 4, weightKg: 60, reps: 5, useFor1rm: true },
      { setNumber: 4, weightKg: 62, reps: 5, useFor1rm: true },
      { setNumber: 5, weightKg: 65, reps: 5, useFor1rm: true },
    ] as never)
    expect(returned).toHaveLength(2)
    for (const set of returned) {
      const { rows: [stored] } = await pool.query(
        `SELECT set_number, weight_kg FROM set_logs WHERE id = $1`, [set.id])
      expect(stored.set_number).toBe(set.setNumber)
      expect(Number(stored.weight_kg)).toBe(set.weightKg)
    }
  })
})
