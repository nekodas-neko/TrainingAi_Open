// Issue 2648. The coach's `getPlateauReport` used to build its own 1RM series from
// `getWorkoutSessionsFrom`, so after #2460 (baseline sessions left out of the card's series) it could
// call a lift "improving" while the Strength trend card said "Plateau". It now reads the card's own
// series (`getExercise1rmHistory`, 180-day window) and the verdict is the shared `isRmPlateau`.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { projectRm, isRmPlateau } from '@trainingai/shared/health/strength-projection'

const canRun = !!process.env.DATABASE_URL

const TZ = 'Australia/Brisbane'
const OWNER = '00000000-0000-4000-8000-000000264801'
const STRANGER = '00000000-0000-4000-8000-000000264802'
const PROGRAM = '00000000-0000-4000-8000-000000264803'
const PROG_SESSION = '00000000-0000-4000-8000-000000264804'

const BENCH = 'Issue2648 Bench'
const ROW = 'Issue2648 Row'
const SQUAT = 'Issue2648 Squat'
const PRESS = 'Issue2648 Press'
const CURL = 'Issue2648 Curl'

let sessionUser: { id: string; timezone?: string } | null = { id: OWNER, timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

const daysAgo = (n: number) => new Date(`${shiftDateStr(todayInTz(TZ), -n)}T12:00:00+10:00`)

/** The owner's bench from #2460's fixture: 82.75 at 26 days ago is the baseline estimate. */
const OWNER_BENCH: { daysAgo: number; rm: number; baseline?: true }[] = [
  { daysAgo: 33, rm: 101.25 },
  { daysAgo: 29, rm: 103.75 },
  { daysAgo: 26, rm: 82.75, baseline: true },
  { daysAgo: 22, rm: 91.25 },
  { daysAgo: 15, rm: 96.25 },
  { daysAgo: 8, rm: 100 },
  { daysAgo: 1, rm: 102.5 },
]

type Trend = 'improving' | 'plateaued' | 'declining'
type Report = { exercises: { exerciseName: string; trend: Trend; sessionsAnalyzed: number; daysSinceLastPr: number | null }[] }

describe.skipIf(!canRun)('the coach plateau report reads the Strength trend card series (issue 2648)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let getStrength: typeof import('@/app/api/strength-trend/route').GET
  let buildChatTools: typeof import('@/lib/ai-chat/tools').buildChatTools

  const log = async (opts: {
    user?: string; name: string; at: Date; rm: number
    phaseType?: string | null; deloaded?: boolean
  }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type)
       VALUES ($1, 'Issue2648', $2, $2::timestamptz + interval '50 min', $3) RETURNING id`,
      [opts.user ?? OWNER, opts.at, opts.phaseType ?? null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ws.id, opts.name, opts.rm, opts.deloaded ?? false, opts.at])
    await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 60, 8)`, [el.id])
  }

  const seedBench = async (baselineTag: 'baseline' | null) => {
    for (const p of OWNER_BENCH) {
      await log({ name: BENCH, at: daysAgo(p.daysAgo), rm: p.rm, phaseType: p.baseline ? baselineTag : null })
    }
  }

  const coach = async (): Promise<Report> => {
    const tools = buildChatTools(repo, OWNER, TZ, todayInTz(TZ))
    return (await tools.getPlateauReport.execute!({}, { toolCallId: 't', messages: [] })) as Report
  }
  const coachTrend = async (name: string) => (await coach()).exercises.find(e => e.exerciseName === name)

  /** The card: the route's history for the lift and the badge's own expression. */
  const card = async (name: string) => {
    const t = (await (await getStrength()).json()).exercises.find((e: { name: string }) => e.name === name)
    return { history: t.history as { date: string; rm: number }[], plateau: isRmPlateau(t.history) }
  }

  /**
   * `getPlateauReport` exactly as it stood on main before issue 2648: its own series, one point per
   * log, `estimated1rm <= 0` the only gate. Kept as the oracle for the characterization case.
   */
  const mainCoach = async (): Promise<Report> => {
    const sessions = await repo.getWorkoutSessionsFrom(OWNER, new Date(Date.now() - 180 * 86_400_000))
    const recentPrs = await repo.listRecentPersonalRecords(OWNER, new Date(Date.now() - 3650 * 86_400_000), new Date())
    const byExercise = new Map<string, { date: Date; orm: number }[]>()
    for (const ws of sessions) {
      for (const el of ws.exercises) {
        if (el.estimated1rm == null || el.estimated1rm <= 0) continue
        const arr = byExercise.get(el.exerciseName) ?? []
        arr.push({ date: ws.startedAt, orm: el.estimated1rm })
        byExercise.set(el.exerciseName, arr)
      }
    }
    const recordDates = new Map(recentPrs.map(r => [r.exerciseName, r.achievedAt]))
    const now = Date.now()
    const exercises = [...byExercise.entries()]
      .filter(([, entries]) => entries.length >= 3)
      .map(([name, entries]) => {
        const sorted = entries.sort((a, b) => a.date.getTime() - b.date.getTime())
        const proj = projectRm(sorted.map(e => ({ date: formatInTimeZone(e.date, TZ, 'yyyy-MM-dd'), rm: e.orm })))
        const trend: Trend = !proj ? 'plateaued' : proj.plateau ? 'plateaued' : proj.slopePerWeek > 0 ? 'improving' : 'declining'
        const prDate = recordDates.get(name)
        const daysSincePr = prDate ? Math.round((now - prDate.getTime()) / 86_400_000) : null
        return { exerciseName: name, trend, sessionsAnalyzed: sorted.length, daysSinceLastPr: daysSincePr }
      })
      .sort((a, b) => (b.daysSinceLastPr ?? 0) - (a.daysSinceLastPr ?? 0))
    return { exercises }
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    const { getRepository } = await import('@/lib/data')
    repo = await getRepository()
    ;({ GET: getStrength } = await import('@/app/api/strength-trend/route'))
    ;({ buildChatTools } = await import('@/lib/ai-chat/tools'))
    for (const id of [OWNER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
         ON CONFLICT (id) DO NOTHING`, [id, `issue2648-${id}@example.com`, TZ])
    }
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'Issue2648', true)
       ON CONFLICT (id) DO NOTHING`, [PROGRAM, OWNER])
    await pool.query(
      `INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'Upper', 0)
       ON CONFLICT (id) DO NOTHING`, [PROG_SESSION, PROGRAM])
    for (const [i, n] of [BENCH, ROW, SQUAT, PRESS, CURL].entries()) {
      await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES
           ($1, $2, ARRAY['chest'], $3) ON CONFLICT DO NOTHING`, [PROG_SESSION, n, i])
    }
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

  // Lifts with no baseline or deload rows, one session a day: the coach answers what main answered.
  it('answers byte for byte what main answered on lifts without baseline or deload rows', async () => {
    const rising = [100, 102.5, 105, 107.5, 110, 112.5]
    for (const [i, rm] of rising.entries()) await log({ name: BENCH, at: daysAgo(60 - i * 8), rm })
    for (const [i, rm] of [80, 80.5, 80, 80.5, 80].entries()) await log({ name: ROW, at: daysAgo(70 - i * 10), rm })
    for (const [i, rm] of [140, 135, 130, 126, 120].entries()) await log({ name: SQUAT, at: daysAgo(50 - i * 9), rm })
    for (const [i, rm] of [60, 61, 62].entries()) await log({ name: PRESS, at: daysAgo(30 - i * 9), rm })
    for (const [i, rm] of [30, 31].entries()) await log({ name: CURL, at: daysAgo(20 - i * 9), rm }) // < 3 points: not reported
    // A point 120 days back: outside the card's 90, inside the coach's 180.
    await log({ name: SQUAT, at: daysAgo(120), rm: 150 })

    const now = await coach()
    expect(JSON.stringify(now)).toBe(JSON.stringify(await mainCoach()))
    expect(now.exercises.map(e => [e.exerciseName, e.trend, e.sessionsAnalyzed]).sort()).toEqual([
      [BENCH, 'improving', 6], [PRESS, 'improving', 3], [ROW, 'plateaued', 5], [SQUAT, 'declining', 6],
    ].sort())
  })

  it('the 180-day window: a point 170 days back counts, one 190 days back does not', async () => {
    for (const [i, rm] of [100, 101, 102].entries()) await log({ name: ROW, at: daysAgo(20 - i * 5), rm })
    await log({ name: ROW, at: daysAgo(170), rm: 90 })
    await log({ name: ROW, at: daysAgo(190), rm: 50 })
    expect((await coachTrend(ROW))?.sessionsAnalyzed).toBe(4)
  })

  // The bug: with the baseline dip counted the coach saw a climb. The card, and now the coach, see the plateau.
  it('owner bench, baseline run tagged: the coach and the card both say plateau', async () => {
    await seedBench('baseline')
    const c = await card(BENCH)
    expect(c.history).toHaveLength(6)
    expect(c.plateau).toBe(true)
    expect((await coachTrend(BENCH))?.trend).toBe('plateaued')
    expect((await coachTrend(BENCH))?.sessionsAnalyzed).toBe(6)
    expect((await mainCoach()).exercises.find(e => e.exerciseName === BENCH)?.trend).toBe('improving') // main's disagreement
  })

  it('owner bench, baseline run still untagged: both read the dip and both say not a plateau', async () => {
    await seedBench(null)
    const c = await card(BENCH)
    expect(c.history).toHaveLength(7)
    expect(c.plateau).toBe(false)
    expect((await coachTrend(BENCH))?.trend).toBe('improving')
    expect((await coachTrend(BENCH))?.sessionsAnalyzed).toBe(7)
  })

  it('a deload is left out of the coach exactly as it is from the card, even with a non-zero estimate', async () => {
    for (const [i, rm] of [100, 100.2, 100.1, 100].entries()) await log({ name: ROW, at: daysAgo(40 - i * 8), rm })
    await log({ name: ROW, at: daysAgo(12), rm: 150, deloaded: true }) // stored non-zero: the marker must win
    await log({ name: ROW, at: daysAgo(6), rm: 40, deloaded: true })
    const c = await card(ROW)
    const t = await coachTrend(ROW)
    expect(c.history.map(p => p.rm)).toEqual([100, 100.2, 100.1, 100])
    expect(t?.sessionsAnalyzed).toBe(4)
    expect(c.plateau).toBe(true)
    expect(t?.trend).toBe('plateaued')
    expect((await mainCoach()).exercises.find(e => e.exerciseName === ROW)?.sessionsAnalyzed).toBe(6) // main counted them
  })

  it('counts one point per local day, as the card does', async () => {
    for (const [i, rm] of [100, 101, 102].entries()) await log({ name: ROW, at: daysAgo(30 - i * 8), rm })
    await log({ name: ROW, at: new Date(daysAgo(14).getTime() + 3_600_000), rm: 99 }) // 2nd session, same day as the 3rd
    await log({ name: ROW, at: daysAgo(6), rm: 104 })
    expect((await coachTrend(ROW))?.sessionsAnalyzed).toBe(4)
    expect((await card(ROW)).history).toHaveLength(4)
  })

  it("never reads another user's rows", async () => {
    for (const [i, rm] of [100, 101, 102].entries()) await log({ name: ROW, at: daysAgo(30 - i * 8), rm })
    for (const [i, rm] of [300, 200, 100, 50].entries()) await log({ user: STRANGER, name: ROW, at: daysAgo(30 - i * 5), rm })
    expect((await coachTrend(ROW))?.sessionsAnalyzed).toBe(3)
  })
})
