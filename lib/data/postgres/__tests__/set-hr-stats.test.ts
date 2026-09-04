// Per-set HR snapshot round-trip (migration 139). Proves the real Drizzle path against Postgres: the
// rich set-detail query, the fuller-wins COALESCE upsert, the per-session + per-exercise reads, and
// the missing-list backfill work-list. Runs only with a local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SetHrRow } from '@trainingai/shared/workout/set-hr-stats'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-0000000c5e70'
const WS = '00000000-0000-4000-8000-0000000c5e71'
const EL = '00000000-0000-4000-8000-0000000c5e72'
const SL1 = '00000000-0000-4000-8000-0000000c5e73'
const SL2 = '00000000-0000-4000-8000-0000000c5e74'
const EXID = '00000000-0000-4000-8000-0000000c5e75'
// Isolated session for the coverage-aware missing-list test — must never see a fuller upsert from
// another test, or the fuller-wins upsert would silently protect it from ever going back to 0.
const WS2 = '00000000-0000-4000-8000-0000000c5e76'
const EL2 = '00000000-0000-4000-8000-0000000c5e77'
const SL3 = '00000000-0000-4000-8000-0000000c5e78'
const SL4 = '00000000-0000-4000-8000-0000000c5e79'
// Distinct identity so WS2's rows don't join the EXID/'Bench Press' per-exercise counts elsewhere
// in this file.
const EXID2 = '00000000-0000-4000-8000-0000000c5e7a'

function mkRow(over: Partial<SetHrRow> & { setLogId: string }): SetHrRow {
  return {
    exerciseLogId: EL, exerciseId: EXID, exerciseName: 'Bench Press', phaseType: 'peak', setNumber: 1,
    intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date('2026-07-10T02:00:00Z'),
    peakBpm: 170, avgBpm: 150, bpmAtEnd: 165, drop30s: 20, drop60s: 30, drop90s: 40, drop120s: 45,
    troughBpm: 120, secToPreset: 50, recoveredPreset: true, secToResting: null, recoveredResting: false,
    pctHrrAtRestEnd: 60, secToHrr50: 25, restAdequate: true, readingsCount: 40, coverageOk: true,
    source: 'chest_strap',
    ...over,
  }
}

describe.skipIf(!canRun)('set_hr_stats round-trip', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [U, `sethr-${U}@example.com`])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [U])
    await pool.query(
      `INSERT INTO workout_sessions (id,user_id,session_name,started_at,completed_at,phase_type)
       VALUES ($1,$2,'Push', now()-interval '2 days', now()-interval '2 days'+interval '1 hour','peak')`,
      [WS, U])
    // exercise_id left null here (FK → exercise_library); the denormalised EXID lives on set_hr_stats,
    // which has no such FK, exercised via the per-exercise read below.
    await pool.query(
      `INSERT INTO exercise_logs (id,workout_session_id,exercise_name,logged_at)
       VALUES ($1,$2,'Bench Press', now()-interval '2 days')`, [EL, WS])
    const base = Date.now() - 2 * 86_400_000
    await pool.query(
      `INSERT INTO set_logs (id,exercise_log_id,set_number,weight_kg,reps,intensity_pct,planned_pct,rest_time_sec,set_start_ms,set_end_ms)
       VALUES ($1,$3,1,100,3,90,90,90,$4,$5), ($2,$3,2,100,3,90,90,90,$6,$7)`,
      [SL1, SL2, EL, base, base + 30_000, base + 120_000, base + 150_000])

    await pool.query(
      `INSERT INTO workout_sessions (id,user_id,session_name,started_at,completed_at,phase_type)
       VALUES ($1,$2,'Pull', now()-interval '3 days', now()-interval '3 days'+interval '1 hour','peak')`,
      [WS2, U])
    await pool.query(
      `INSERT INTO exercise_logs (id,workout_session_id,exercise_name,logged_at)
       VALUES ($1,$2,'Deadlift', now()-interval '3 days')`, [EL2, WS2])
    await pool.query(
      `INSERT INTO set_logs (id,exercise_log_id,set_number,weight_kg,reps,intensity_pct,planned_pct,rest_time_sec,set_start_ms,set_end_ms)
       VALUES ($1,$3,1,140,3,90,90,90,$4,$5), ($2,$3,2,140,3,90,90,90,$6,$7)`,
      [SL3, SL4, EL2, base, base + 30_000, base + 120_000, base + 150_000])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [U])
    await pool.query(`DELETE FROM users WHERE id=$1`, [U])
  })

  it('reads the rich set details for a session', async () => {
    const sets = await repo.getSetDetailsForSession(U, WS)
    expect(sets).toHaveLength(2)
    expect(sets[0]).toMatchObject({ exerciseName: 'Bench Press', phaseType: 'peak', intensityPct: 90 })
    expect(sets[0].setStartMs).not.toBeNull()
  })

  it('is on the missing-list before any snapshot, and off it after', async () => {
    const since = new Date(Date.now() - 180 * 86_400_000)
    const before = await repo.listSessionsMissingSetHrStats(U, since, 10)
    expect(before.map(s => s.id)).toContain(WS)

    await repo.upsertSetHrStats(U, WS, [mkRow({ setLogId: SL1 }), mkRow({ setLogId: SL2, setNumber: 2 })])

    const after = await repo.listSessionsMissingSetHrStats(U, since, 10)
    expect(after.map(s => s.id)).not.toContain(WS)
  })

  it('Q-11 Defect B: a zero-reading snapshot stays on the missing-list, not just a missing row', async () => {
    // Uses an isolated session (WS2) — the fuller-wins upsert would otherwise protect any session
    // that already has a real (non-zero) row from ever going back to 0 here.
    //
    // Simulates a completion-time compute that ran before the ring/strap data landed: every set
    // gets a row, but readings_count is 0 across the board. Before the coverage-aware fix, any row
    // at all — even one with no real data — removed the session from this list forever.
    const since = new Date(Date.now() - 180 * 86_400_000)
    const before = await repo.listSessionsMissingSetHrStats(U, since, 10)
    expect(before.map(s => s.id)).toContain(WS2)

    const mkRow2 = (over: Partial<SetHrRow> & { setLogId: string }) =>
      mkRow({ exerciseLogId: EL2, exerciseId: EXID2, exerciseName: 'Deadlift', ...over })

    await repo.upsertSetHrStats(U, WS2, [
      mkRow2({ setLogId: SL3, readingsCount: 0, coverageOk: false, peakBpm: null, avgBpm: null }),
      mkRow2({ setLogId: SL4, setNumber: 2, readingsCount: 0, coverageOk: false, peakBpm: null, avgBpm: null }),
    ])
    const stillMissing = await repo.listSessionsMissingSetHrStats(U, since, 10)
    expect(stillMissing.map(s => s.id)).toContain(WS2)

    // A later, fuller compute for at least one set clears it from the list again.
    await repo.upsertSetHrStats(U, WS2, [mkRow2({ setLogId: SL3, readingsCount: 40 })])
    const afterFuller = await repo.listSessionsMissingSetHrStats(U, since, 10)
    expect(afterFuller.map(s => s.id)).not.toContain(WS2)
  })

  it('reads back per-session and per-exercise', async () => {
    const bySession = await repo.getSetHrStatsForSession(U, WS)
    expect(bySession).toHaveLength(2)
    expect(bySession[0]).toMatchObject({ peakBpm: 170, drop60s: 30, recoveredResting: false })

    const byExercise = await repo.getSetHrStatsForExercise(U, { exerciseId: EXID, since: new Date(Date.now() - 180 * 86_400_000) })
    expect(byExercise).toHaveLength(2)

    // Name fallback also matches.
    const byName = await repo.getSetHrStatsForExercise(U, { exerciseName: 'Bench Press', since: new Date(Date.now() - 180 * 86_400_000) })
    expect(byName.length).toBeGreaterThanOrEqual(2)
  })

  it('a partial (fewer-readings) recompute never clobbers a fuller snapshot', async () => {
    await repo.upsertSetHrStats(U, WS, [mkRow({ setLogId: SL1, peakBpm: 99, readingsCount: 5, drop60s: null })])
    const [s1] = await repo.getSetHrStatsForSession(U, WS)
    expect(s1.peakBpm).toBe(170) // 5 < 40 → skipped
    expect(s1.drop60s).toBe(30)
  })

  it('a fuller recompute wins and COALESCE keeps a value the new one lost', async () => {
    await repo.upsertSetHrStats(U, WS, [mkRow({ setLogId: SL1, peakBpm: 180, readingsCount: 50, secToResting: null })])
    const [s1] = await repo.getSetHrStatsForSession(U, WS)
    expect(s1.peakBpm).toBe(180)       // 50 >= 40 → update
    expect(s1.secToResting).toBeNull() // stayed null both times
    expect(s1.secToPreset).toBe(50)    // COALESCE kept the earlier value
  })

  // The `source` column existed since migration 139 and was never written — 582 production rows,
  // all null. The shared unit tests cover the derivation; these cover the leg that actually failed
  // for its sibling `workout_hr_stats`, where the value reached the DB and was rejected there.
  it('persists the device that measured each set, and reads it back', async () => {
    await repo.upsertSetHrStats(U, WS, [
      mkRow({ setLogId: SL1, source: 'chest_strap', readingsCount: 90 }),
      mkRow({ setLogId: SL2, setNumber: 2, source: 'mixed', readingsCount: 90 }),
    ])
    const rows = await repo.getSetHrStatsForSession(U, WS)
    const bySet = new Map(rows.map(r => [r.setLogId, r.source]))
    expect(bySet.get(SL1)).toBe('chest_strap')
    expect(bySet.get(SL2)).toBe('mixed')
  })

  it('a later compute that lost the source keeps the stored one (COALESCE, like its siblings)', async () => {
    await repo.upsertSetHrStats(U, WS, [mkRow({ setLogId: SL1, source: null, readingsCount: 120 })])
    const rows = await repo.getSetHrStatsForSession(U, WS)
    expect(rows.find(r => r.setLogId === SL1)!.source).toBe('chest_strap')
  })
})

// Full server seam: computeWorkoutHr must resolve the baseline, join the rich set details, run the
// formula, and hand back per-set rows the recap route can persist — the wiring the unit tests can't see.
const WS3 = '00000000-0000-4000-8000-0000000c5e80'
const EL3 = '00000000-0000-4000-8000-0000000c5e81'
const SLA = '00000000-0000-4000-8000-0000000c5e82'

describe.skipIf(!canRun)('computeWorkoutHr → per-set rows (integration)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const started = new Date(Date.now() - 2 * 3_600_000) // 2h ago
  const completed = new Date(Date.now() - 3_600_000)    // 1h ago
  const setStart = new Date(started.getTime() + 10 * 60_000)
  const setEnd = new Date(setStart.getTime() + 40_000)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id,email,password_hash,timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [U, `sethr-${U}@example.com`])
    await pool.query(`DELETE FROM workout_sessions WHERE id=$1`, [WS3])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id=$1`, [U])
    await pool.query(
      `INSERT INTO workout_sessions (id,user_id,session_name,started_at,completed_at,phase_type)
       VALUES ($1,$2,'Push',$3,$4,'peak')`, [WS3, U, started, completed])
    await pool.query(
      `INSERT INTO exercise_logs (id,workout_session_id,exercise_name,logged_at)
       VALUES ($1,$2,'Squat',$3)`, [EL3, WS3, setEnd])
    await pool.query(
      `INSERT INTO set_logs (id,exercise_log_id,set_number,weight_kg,reps,intensity_pct,rest_time_sec,set_start_ms,set_end_ms)
       VALUES ($1,$2,1,140,3,90,120,$3,$4)`, [SLA, EL3, setStart.getTime(), setEnd.getTime()])
    // HR readings: rising through the set (peak 172), then recovering during the rest.
    const pts: [number, number][] = [
      [0, 120], [10, 150], [25, 165], [38, 172], [40, 168],       // within the set
      [55, 150], [70, 135], [90, 118], [110, 105], [130, 98],      // rest recovery
    ]
    for (const [sec, bpm] of pts) {
      await pool.query(
        `INSERT INTO oura_heartrate (user_id,timestamp,bpm,source) VALUES ($1,$2,$3,'chest_strap')
         ON CONFLICT DO NOTHING`, [U, new Date(setStart.getTime() + sec * 1000), bpm])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE id=$1`, [WS3])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id=$1`, [U])
  })

  it('produces a per-set row with a real working-window peak and rest recovery', async () => {
    const computed = await computeWorkoutHr(repo, U, { id: WS3, startedAt: started, completedAt: completed }, 'Australia/Brisbane')
    expect(computed).not.toBeNull()
    expect(computed!.setHrRows).toHaveLength(1)
    const row = computed!.setHrRows[0]
    expect(row.peakBpm).toBe(172)      // true working-window max, not a proxy
    expect(row.bpmAtEnd).toBe(168)
    expect(row.drop60s).toBeGreaterThan(0) // HR fell during the rest that followed
    expect(row.coverageOk).toBe(true)
    expect(row.exerciseName).toBe('Squat')
    expect(row.intensityPct).toBe(90)
  })
})
