// #2460. The 90-day 1RM history behind the Strength trend card and the engine's plateau flag
// (`getExercise1rmHistory`) leaves baseline sessions out — the owner's decision of 2026-10-07.
//
// A baseline session logs one unprescribed set, so its estimate is AMRAP-scaled, while every other
// point is a prescribed set divided by its own %1RM. On the owner's bench the 09-07 → 09-12
// baseline read 82.75 between a prescribed 103.75 and 91.25 (#2297's production window), and the
// history drew it as a dip that the % change, the 30-day projection, the 90-day low and the plateau
// check all took as real.
//
// The predicate is #2297's (`wsIsBaselineSession`), so a NULL tag — every row before TN-75 — is NOT
// baseline and stays in. Those rows only leave the chart once the production backfill tags them
// (`scripts/backfill-baseline-phase-tag.mjs`); the "untagged" half of the owner example below is
// exactly what production shows until then.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { projectRm } from '@trainingai/shared/health/strength-projection'

const canRun = !!process.env.DATABASE_URL

const TZ = 'Australia/Brisbane'
const OWNER = '00000000-0000-4000-8000-000000246001'
const STRANGER = '00000000-0000-4000-8000-000000246002'
const PROGRAM = '00000000-0000-4000-8000-000000246003'
const PROG_SESSION = '00000000-0000-4000-8000-000000246004'

const BENCH = 'Issue2460 Bench'
const ROW = 'Issue2460 Row'
const SQUAT = 'Issue2460 Squat'

let sessionUser: { id: string; timezone?: string } | null = { id: OWNER, timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

/**
 * `getExercise1rmHistory`'s query exactly as it stood on main before #2460 (LA-96's version), kept
 * here as the oracle for the characterization case: on rows with no baseline tag the new query must
 * answer byte for byte what this one does.
 */
const MAIN_HISTORY_SQL = `
    SELECT
      el.exercise_name,
      to_char((ws.started_at AT TIME ZONE $2), 'YYYY-MM-DD') AS session_date,
      MAX(el.estimated_1rm)::double precision AS rm
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    WHERE ws.user_id = $1::uuid
      AND el.exercise_name = ANY($3)
      AND el.estimated_1rm IS NOT NULL
      AND el.estimated_1rm > 0
      AND el.exercise_deloaded = false
      AND ws.started_at >= NOW() - INTERVAL '90 days'
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY el.exercise_name, session_date
    ORDER BY el.exercise_name, session_date`

/** Midday, N local days ago — inside the 90-day window and never on a day boundary. */
const daysAgo = (n: number) => new Date(`${shiftDateStr(todayInTz(TZ), -n)}T12:00:00+10:00`)
const localDay = (n: number) => shiftDateStr(todayInTz(TZ), -n)

/**
 * The owner's bench, oldest first. The three middle values are the production ones #2297 measured
 * (103.75 prescribed → 82.75 baseline, 60 kg × 15 → 91.25 prescribed); the points around them are
 * a synthetic but ordinary run of weekly sessions, so the projection has a series to fit.
 */
const OWNER_BENCH: { daysAgo: number; rm: number; baseline?: true }[] = [
  { daysAgo: 33, rm: 101.25 },
  { daysAgo: 29, rm: 103.75 },
  { daysAgo: 26, rm: 82.75, baseline: true },
  { daysAgo: 22, rm: 91.25 },
  { daysAgo: 15, rm: 96.25 },
  { daysAgo: 8, rm: 100 },
  { daysAgo: 1, rm: 102.5 },
]

/** The engine's own plateau expression (`signals.ts`), applied to a history. */
const enginePlateau = (h: { date: string; rm: number }[]) =>
  h.length >= 4 ? (projectRm(h)?.plateau ?? false) : false

describe.skipIf(!canRun)('getExercise1rmHistory leaves baseline sessions out (#2460)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let getStrength: typeof import('@/app/api/strength-trend/route').GET

  /** One session holding one exercise log with one set. Returns the session id. */
  const log = async (opts: {
    user?: string; name: string; at: Date; rm: number
    phaseType?: string | null; deloaded?: boolean; sessionDeleted?: boolean; logDeleted?: boolean
  }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type, deleted_at)
       VALUES ($1, 'Issue2460', $2, $2::timestamptz + interval '50 min', $3, $4) RETURNING id`,
      [opts.user ?? OWNER, opts.at, opts.phaseType ?? null, opts.sessionDeleted ? new Date() : null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ws.id, opts.name, opts.rm, opts.deloaded ?? false, opts.at, opts.logDeleted ? new Date() : null])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 60, 8)`, [el.id])
    return ws.id as string
  }

  /** Seeds the owner's bench with the baseline run carrying `baselineTag`. Returns its session id. */
  const seedOwnerBench = async (baselineTag: 'baseline' | null) => {
    let baselineId = ''
    for (const p of OWNER_BENCH) {
      const id = await log({ name: BENCH, at: daysAgo(p.daysAgo), rm: p.rm, phaseType: p.baseline ? baselineTag : null })
      if (p.baseline) baselineId = id
    }
    return baselineId
  }

  const history = (names = [BENCH]) => repo.getExercise1rmHistory(OWNER, names, TZ)
  const mainHistory = async (user: string, names: string[]) => {
    const { rows } = await pool.query(MAIN_HISTORY_SQL, [user, TZ, names])
    const out: Record<string, { date: string; rm: number }[]> = {}
    for (const r of rows) (out[r.exercise_name] ??= []).push({ date: r.session_date, rm: Number(r.rm) })
    return out
  }
  const trend = async () => (await (await getStrength()).json()).exercises.find((e: { name: string }) => e.name === BENCH)

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    const { getRepository } = await import('@/lib/data')
    repo = await getRepository()
    ;({ GET: getStrength } = await import('@/app/api/strength-trend/route'))
    for (const id of [OWNER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
         ON CONFLICT (id) DO NOTHING`, [id, `issue2460-${id}@example.com`, TZ])
    }
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'Issue2460', true)
       ON CONFLICT (id) DO NOTHING`, [PROGRAM, OWNER])
    await pool.query(
      `INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'Upper', 0)
       ON CONFLICT (id) DO NOTHING`, [PROG_SESSION, PROGRAM])
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES
         ($1, $2, ARRAY['chest'], 0) ON CONFLICT DO NOTHING`, [PROG_SESSION, BENCH])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    sessionUser = { id: OWNER, timezone: TZ }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
  })

  it('drops a baseline day and keeps every prescribed one', async () => {
    await seedOwnerBench('baseline')
    const points = (await history())[BENCH]
    expect(points.map(p => p.rm)).toEqual([101.25, 103.75, 91.25, 96.25, 100, 102.5])
    expect(points.map(p => p.date)).not.toContain(localDay(26))
  })

  // Every production row before TN-75 is NULL. Unknown is not baseline: it is read as it always was.
  it('keeps an untagged (NULL) session, and any phase that is not baseline', async () => {
    await log({ name: ROW, at: daysAgo(20), rm: 70 })
    await log({ name: ROW, at: daysAgo(12), rm: 72, phaseType: 'normal' })
    await log({ name: ROW, at: daysAgo(5), rm: 75, phaseType: 'testing' })
    expect((await history([ROW]))[ROW].map(p => p.rm)).toEqual([70, 72, 75])
  })

  // A gap, not a zero: the chart and the projection have no point to draw for that day.
  it('gives a day whose only points are baseline no point at all', async () => {
    await log({ name: ROW, at: daysAgo(20), rm: 70 })
    await log({ name: ROW, at: daysAgo(12), rm: 60, phaseType: 'baseline' })
    await log({ name: ROW, at: daysAgo(5), rm: 75 })
    const points = (await history([ROW]))[ROW]
    expect(points).toEqual([{ date: localDay(20), rm: 70 }, { date: localDay(5), rm: 75 }])
  })

  // An exercise trained only in a baseline so far has no history, so the card skips it rather than
  // charting a calibration as a strength level.
  it('returns no series for an exercise logged only in a baseline', async () => {
    await log({ name: ROW, at: daysAgo(3), rm: 60, phaseType: 'baseline' })
    expect((await history([ROW]))[ROW]).toBeUndefined()
  })

  // Two sessions on one local day: the day's point is the prescribed max, even when the baseline
  // estimate is higher — the baseline is out of the MAX, not just out of the series.
  it('takes a mixed day from its prescribed session only', async () => {
    await log({ name: ROW, at: daysAgo(10), rm: 120, phaseType: 'baseline' })
    await log({ name: ROW, at: new Date(daysAgo(10).getTime() + 3 * 3_600_000), rm: 80 })
    expect((await history([ROW]))[ROW]).toEqual([{ date: localDay(10), rm: 80 }])
  })

  it("never reads another user's rows, baseline or not", async () => {
    await log({ user: STRANGER, name: BENCH, at: daysAgo(4), rm: 300 })
    await log({ user: STRANGER, name: BENCH, at: daysAgo(2), rm: 290, phaseType: 'baseline' })
    await log({ name: BENCH, at: daysAgo(3), rm: 100 })
    expect((await history())[BENCH]).toEqual([{ date: localDay(3), rm: 100 }])
  })

  // Characterization: with no baseline tag anywhere, the answer is main's, byte for byte — every
  // other gate (deload, soft delete, 90-day window, one point per day, MAX, ordering, the user
  // scope) is untouched.
  it('answers exactly what main answered on rows with no baseline tag', async () => {
    await seedOwnerBench(null)
    for (const [d, rm, extra] of [
      [40, 140, {}], [30, 150, { phaseType: 'normal' }], [30, 155, {}], [21, 158, { phaseType: 'testing' }],
      [14, 170, { deloaded: true }], [9, 160, { sessionDeleted: true }], [7, 161, { logDeleted: true }],
      [95, 130, {}], [2, 162.5, {}],
    ] as const) await log({ name: SQUAT, at: daysAgo(d), rm, ...extra })
    await log({ user: STRANGER, name: SQUAT, at: daysAgo(6), rm: 999 })

    const names = [BENCH, SQUAT, ROW]
    const now = await repo.getExercise1rmHistory(OWNER, names, TZ)
    expect(JSON.stringify(now)).toBe(JSON.stringify(await mainHistory(OWNER, names)))
    expect(now[SQUAT].map(p => p.rm)).toEqual([140, 155, 158, 162.5])
  })

  /**
   * The owner's bench, before and after the backfill tags its baseline run. "Before" is what
   * production shows today (the run is NULL-tagged) and what main showed; "after" is the fixed
   * reading. The numbers are the PR's before/after table.
   */
  describe('the owner example: Strength trend payload and plateau flag', () => {
    it('before the backfill: the 82.75 baseline is a dip (as on main)', async () => {
      await seedOwnerBench(null)
      const h = (await history())[BENCH]
      expect(JSON.stringify({ [BENCH]: h })).toBe(JSON.stringify(await mainHistory(OWNER, [BENCH])))

      const t = await trend()
      expect(t.history).toHaveLength(7)
      expect({ gainPct: t.gainPct, currentRm: t.currentRm, startRm: t.startRm, peakRm: t.peakRm })
        .toEqual({ gainPct: 1, currentRm: 102.5, startRm: 101.25, peakRm: 103.75 })
      expect(Math.min(...t.history.map((p: { rm: number }) => p.rm))).toBe(82.75) // card's "90d low"
      expect(projectRm(t.history)).toEqual({ projectedRm: 106.87, slopePerWeek: 1.021, plateau: false })
      expect(enginePlateau(h)).toBe(false)
    })

    it('after the backfill: the baseline day is gone, and the lift reads as the plateau it is', async () => {
      await seedOwnerBench('baseline')
      const h = (await history())[BENCH]

      const t = await trend()
      expect(t.history).toHaveLength(6)
      expect({ gainPct: t.gainPct, currentRm: t.currentRm, startRm: t.startRm, peakRm: t.peakRm })
        .toEqual({ gainPct: 1, currentRm: 102.5, startRm: 101.25, peakRm: 103.75 })
      expect(Math.min(...t.history.map((p: { rm: number }) => p.rm))).toBe(91.25)
      expect(projectRm(t.history)).toEqual({ projectedRm: 102.75, slopePerWeek: 0.058, plateau: true })
      expect(enginePlateau(h)).toBe(true)
    })

    // Straight after a rebuild the baseline is the newest point. On main it was the headline
    // number and the end of the % change; now the card reads the last prescribed estimate.
    it('right after a rebuild, the headline is the last prescribed estimate, not the baseline', async () => {
      for (const p of OWNER_BENCH.slice(0, 3)) {
        await log({ name: BENCH, at: daysAgo(p.daysAgo), rm: p.rm, phaseType: p.baseline ? 'baseline' : null })
      }
      const t = await trend()
      expect({ currentRm: t.currentRm, gainPct: t.gainPct }).toEqual({ currentRm: 103.75, gainPct: 2 })
      const main = (await mainHistory(OWNER, [BENCH]))[BENCH]
      expect(main.at(-1)!.rm).toBe(82.75) // main's headline, a −18% "decline"
    })
  })
})
