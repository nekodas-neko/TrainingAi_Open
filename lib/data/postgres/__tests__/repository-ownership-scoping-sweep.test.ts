// Ownership scoping, part 2: the survivors of the 2026-10-07 mutation sweep (#2425).
//
// `repository-ownership-scoping.test.ts` is the hand-built burn-down from Q-155. Re-running its
// mutation method on 2026-10-07 (`scripts/ownership-mutation-sweep/`) found that most of the
// data layer's `user_id` predicates could still be deleted with that file green — mostly because the
// other user (B) had no row in the table at all, so a leak had nothing to leak. Write-up:
// `docs/reviews/2026-10-07-ownership-mutation-coverage.md`.
//
// This file closes that the cheap, mechanical way:
//
//   - B gets a row in EVERY table a user's data lives in, derived from the live schema
//     (`every-user-table-fixture.ts`), so there is always something to leak.
//   - READERS: A owns nothing, so every reader A calls must come back empty — and must not carry
//     any id or text B's rows hold. One row per method.
//   - WRITERS: A calls the method aimed at B's ids (or at the same date B has data on). Every row
//     B owns must be byte-for-byte unchanged afterwards. One row per method.
//
// Every row here was checked by the sweep to FAIL when its method's predicate is neutralised. A row
// that cannot fail is worse than no row; add new ones the same way (`node
// scripts/ownership-mutation-sweep/index.mjs --file <slice>`), never on intent.
//
// Runs only against a real Postgres — skips cleanly when DATABASE_URL is absent.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  readSchemaGraph, cascadeClosure, setNullToUsers, seedEveryUserTable,
  type SchemaGraph, type SeededUser, type Row,
} from './every-user-table-fixture'

const canRun = !!process.env.DATABASE_URL

// Distinct from the part-1 file's users: vitest runs files in parallel against one database.
const USER_A = '00000000-0000-4000-8000-00000242a5a0'
const USER_B = '00000000-0000-4000-8000-00000242a5b0'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_A, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

// The fixture's own date for every DATE column; timestamps are pinned to midday on it in Brisbane.
const D = '2026-09-15'
// The day-log readers take the route's slash form.
const D_SLASH = '2026/09/15'
const AT = new Date('2026-09-15T02:00:00Z')
const FROM = '2026-09-01'
const TO = '2026-09-30'
const FROM_TS = new Date('2026-09-01T00:00:00Z')
const TO_TS = new Date('2026-10-01T00:00:00Z')
const TZ = 'Australia/Brisbane'

type Repo = import('@/lib/data/repository').WorkoutRepository
/** Public on the Postgres adapter, absent from the repository interface. */
interface AdapterExtras {
  getOuraClockEpochHead(userId: string): Promise<unknown>
  getNewestOuraClockAnchorByUtc(userId: string): Promise<unknown>
}
/** A complete plan meal, so a request that slips past an ownership check would actually insert. */
const MEAL = { position: 0, name: 'A MEAL', targetCalories: 500, targetProteinG: 30, targetCarbsG: 50, targetFatG: 15 }
const oura = () => import('@/lib/data/postgres/slices/oura')
const rawFrames = () => import('@/lib/data/postgres/slices/oura-raw-frames')

describe.skipIf(!canRun)('repository ownership scoping — sweep survivors (#2425)', () => {
  let pool: import('pg').Pool
  let repo: Repo
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let g: SchemaGraph
  let b: SeededUser
  let owned: string[]
  let bOpenSession = ''
  let userTables: string[]
  const createdCatalogue: Row[] = []
  /** Every string B's rows hold that is distinctive enough to grep for — ids and fixture text. */
  const bTokens = new Set<string>()

  const bRow = (t: string): Row => {
    const r = b.rows.get(t)
    if (!r) throw new Error(`fixture has no ${t} row`)
    return r
  }
  const bId = (t: string) => bRow(t).id as string
  const bNum = (t: string) => Number(bRow(t).id)
  const bVal = (t: string, col: string) => bRow(t)[col] as string

  /** B's rows, read back by primary key, plus B's row count in every table with a user_id. */
  // One statement, one round trip: a subselect per table. Built once in beforeAll.
  let snapshotSql = ''
  let snapshotParams: unknown[] = []
  function buildSnapshot() {
    const cols: string[] = []
    const params: unknown[] = [USER_B]
    for (const t of owned) {
      const row = b.rows.get(t)!
      const key = g.pk.get(t)
      if (!key) continue
      const where = key.map(k => { params.push(row[k]); return `x."${k}"::text = $${params.length}::text` }).join(' AND ')
      cols.push(`(SELECT row_to_json(x)::text FROM public."${t}" x WHERE ${where}) AS "${t}"`)
    }
    // Every B row of every table with a user_id, hashed — catches a write to a row the fixture did
    // not create (the extra rows added below), and an insert or delete, not only a changed column.
    for (const t of userTables) {
      cols.push(`(SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public."${t}" x WHERE x.user_id = $1) AS "#${t}"`)
    }
    snapshotSql = `SELECT ${cols.join(',\n')}`
    snapshotParams = params
  }
  async function snapshotB(q: Pick<import('pg').Pool, 'query'> = pool): Promise<string> {
    const { rows: [row] } = await q.query(snapshotSql, snapshotParams)
    return JSON.stringify(row)
  }

  function serialise(v: unknown): string {
    return JSON.stringify(v, (_k, x) => {
      if (x instanceof Map) return [...x.entries()]
      if (x instanceof Set) return [...x.values()]
      return x
    }) ?? ''
  }

  function leaked(v: unknown): string[] {
    const s = serialise(v)
    return [...bTokens].filter(tok => s.includes(tok))
  }

  function emptyish(v: unknown): boolean {
    if (v == null || v === false || v === 0 || v === '') return true
    if (Array.isArray(v)) return v.length === 0
    if (v instanceof Map || v instanceof Set) return v.size === 0
    if (v instanceof Date) return false
    if (typeof v === 'object') return Object.values(v as object).every(emptyish)
    return false
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    g = await readSchemaGraph(pool)

    const client = await import('@/lib/data/postgres/client')
    db = client.getDb()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
      // A profile (age, sex) so derived-energy paths run for A instead of returning null early.
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, date_of_birth, sex)
         VALUES ($1, $2, 'x', $3, '1990-01-01', 'male')`,
        [id, `ownership-sweep-2425-${tag}@example.com`, TZ])
    }

    // B's own catalogue parents. The fixture otherwise reuses whatever catalogue row exists, and
    // another DB test file deleting its own season or exercise mid-run would cascade into B's rows
    // and fail a WRITERS snapshot for a reason that has nothing to do with ownership.
    const catalogue = async (sql: string, params: unknown[], table: string) => {
      const { rows: [row] } = await pool.query(sql, params)
      createdCatalogue.push({ __table: table, id: row.id })
      return row
    }
    const parentOverride = {
      seasons: await catalogue(
        `INSERT INTO seasons (label, start_date, end_date) VALUES ('sweep-2425 season', $1, $2) RETURNING *`,
        [FROM, TO], 'seasons'),
      exercise_library: await catalogue(
        `INSERT INTO exercise_library (name) VALUES ('sweep-2425 exercise') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
        [], 'exercise_library'),
      dietary_restrictions: await catalogue(
        `INSERT INTO dietary_restrictions (code, label, category) VALUES ('sweep-2425', 'sweep-2425', 'dislike')
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label RETURNING *`, [], 'dietary_restrictions'),
    }
    b = await seedEveryUserTable(pool, g, USER_B, { at: AT, overrides: B_OVERRIDES, parentOverride })
    createdCatalogue.push(...b.createdCatalogue)

    // Second rows the one-row-per-table fixture cannot express.
    await pool.query(
      `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, decoded, status)
       VALUES ($1, $2, 'b-dismissed-2425-raw', '{}', 'dismissed'), ($1, $2, 'b-confirmed-2425-raw', '{}', 'confirmed')`,
      [USER_B, AT])
    // The fixture's session is completed (readers need that); completeWorkoutSession needs an open one.
    bOpenSession = (await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'B OPEN SESSION', $2) RETURNING id`,
      [USER_B, AT])).rows[0].id
    // A library exercise, so the muscle-attribution reads take their library branch too.
    const { rows: [lib] } = await pool.query(
      `SELECT name FROM exercise_library WHERE jsonb_array_length(muscles) > 0 ORDER BY name LIMIT 1`)
    if (lib) {
      const { rows: [el] } = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, estimated_1rm, exercise_deloaded)
         VALUES ($1, $2, $3, 100, false) RETURNING id`, [bId('workout_sessions'), lib.name, AT])
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 100, 5)`, [el.id])
    }
    owned = [...b.rows.keys()].sort()
    userTables = g.tables.filter(t => (g.columns.get(t) ?? []).some(c => c.name === 'user_id'))
    buildSnapshot()

    for (const row of b.rows.values()) {
      for (const v of Object.values(row)) {
        if (typeof v === 'string' && v.length >= 12 && v !== USER_B && !/^\d{4}-\d{2}-\d{2}/.test(v)) bTokens.add(v)
      }
    }
  }, 120_000)

  afterAll(async () => {
    if (!canRun || !pool) return
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET CONSTRAINTS ALL DEFERRED')
      await c.query(`DELETE FROM food_logs WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
      await c.query('COMMIT')
    } catch {
      await c.query('ROLLBACK').catch(() => {})
    } finally {
      c.release()
    }
    for (const row of createdCatalogue.reverse()) {
      const { __table, ...key } = row as { __table: string } & Record<string, unknown>
      const cols = Object.keys(key)
      await pool.query(`DELETE FROM public."${__table}" WHERE ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ')}`,
        cols.map(c => key[c])).catch(() => {})
    }
  })

  it('the fixture gives B a row in every table a user owns', () => {
    const expected = new Set([...cascadeClosure(g), ...setNullToUsers(g)])
    const missing = [...expected].filter(t => !b.rows.has(t))
    expect(missing).toEqual([])
    expect(bTokens.size).toBeGreaterThan(50)
  })

  it('the B snapshot notices a one-column write and a delete (or every WRITERS row is vacuous)', async () => {
    // Inside a transaction that is rolled back, so B's rows end exactly as seeded.
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const before = await snapshotB(c)
      await c.query(`UPDATE injuries SET notes = 'probe' WHERE id = $1`, [bId('injuries')])
      const afterUpdate = await snapshotB(c)
      expect(afterUpdate).not.toBe(before)
      await c.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER_B])
      expect(await snapshotB(c)).not.toBe(afterUpdate)
    } finally {
      await c.query('ROLLBACK')
      c.release()
    }
  })

  // ---- READERS: A owns nothing, so anything non-empty is B's ----
  //
  // `check` overrides the default (empty AND carries no B token) for a method whose empty answer is
  // not empty-shaped — a default object, an echo of its own arguments.
  type Reader = [name: string, call: (r: Repo) => Promise<unknown>, check?: (v: unknown) => void]
  const READERS: Reader[] = [
    // workout sessions and logs
    ['getCalendarData', r => r.getCalendarData(USER_A, 2026, 9, TZ)],
    ['getRecentTrainedDays', r => r.getRecentTrainedDays(USER_A, 3650, TZ)],
    ['listTrainedDayKeys', r => r.listTrainedDayKeys(USER_A, TZ)],
    ['getDayLog', r => r.getDayLog(USER_A, D_SLASH, TZ)],
    ['getDayExerciseNames', r => r.getDayExerciseNames(USER_A, D_SLASH, TZ)],
    ['getDaySessionSummaries', r => r.getDaySessionSummaries(USER_A, D_SLASH, TZ)],
    ['getWorkoutSessionsFrom', r => r.getWorkoutSessionsFrom(USER_A, FROM_TS)],
    ['getWorkoutSessionDetail', r => r.getWorkoutSessionDetail(USER_A, bId('workout_sessions'))],
    ['getSessionLoadsFrom', r => r.getSessionLoadsFrom(USER_A, FROM_TS)],
    ['getYearReviewTotals', r => r.getYearReviewTotals(USER_A, FROM_TS)],
    ['getYearReviewTopExercises', r => r.getYearReviewTopExercises(USER_A, FROM_TS, 10)],
    ['getLastRealOneRmBatch', r => r.getLastRealOneRmBatch(USER_A, [bVal('exercise_logs', 'exercise_name')])],
    ['getLastExerciseLogsBatch', r => r.getLastExerciseLogsBatch(USER_A, [bVal('exercise_logs', 'exercise_name')])],
    ['getExerciseSummary', r => r.getExerciseSummary(USER_A)],
    ['getExerciseHistoryRows', r => r.getExerciseHistoryRows(USER_A, bVal('exercise_logs', 'exercise_name'), 50)],
    ['listRecent1rm', r => r.listRecent1rm(USER_A)],
    ['getNextSession', r => r.getNextSession(USER_A, TZ), v => expect(leaked(v)).toEqual([])],
    ['countWorkoutSessions', r => r.countWorkoutSessions(USER_A)],
    ['getFirstWorkoutDateForProgram', r => r.getFirstWorkoutDateForProgram(USER_A, [bId('program_sessions')])],
    ['getTimingAuditData', r => r.getTimingAuditData(USER_A, 3650)],
    ['getWorkoutSessionById', r => r.getWorkoutSessionById(USER_A, bId('workout_sessions'))],
    ['getWorkoutSessionProgramSessionId', r => r.getWorkoutSessionProgramSessionId(USER_A, bId('workout_sessions'))],
    ['wasProgramSessionTrainedSince', r => r.wasProgramSessionTrainedSince(USER_A, bId('program_sessions'), FROM_TS)],
    ['getRecentSessionsOfType', r => r.getRecentSessionsOfType(USER_A, bId('program_sessions'), 10)],
    ['getSetTimingRows', r => r.getSetTimingRows(USER_A, [bVal('exercise_logs', 'exercise_name')])],
    ['getExercise1rmHistory', r => r.getExercise1rmHistory(USER_A, [bVal('exercise_logs', 'exercise_name')], TZ),
      v => { expect(leaked(v)).toEqual([]); expect(Object.values(v as object).flat()).toEqual([]) }],
    ['getSessionExercise1rms', r => r.getSessionExercise1rms(USER_A, bId('workout_sessions'))],
    ['getWorkoutSensorProbe', r => r.getWorkoutSensorProbe(USER_A, bId('workout_sessions'))],
    ['getWorkoutSensorProbe (latest)', r => r.getWorkoutSensorProbe(USER_A)],
    // day keys and body metrics
    ['listStepDayKeys', r => r.listStepDayKeys(USER_A, FROM, TO)],
    ['listSleepDayKeys', r => r.listSleepDayKeys(USER_A, FROM, TO)],
    ['listStepTotals', r => r.listStepTotals(USER_A, FROM, TO)],
    ['listFoodLogDayKeys', r => r.listFoodLogDayKeys(USER_A, FROM, TO)],
    ['listWeightDayKeys', r => r.listWeightDayKeys(USER_A, FROM, TO)],
    ['listCardioSessionCounts', r => r.listCardioSessionCounts(USER_A, FROM, TO, [bVal('activity_logs', 'activity_type')])],
    ['listBodyMetrics', r => r.listBodyMetrics(USER_A, FROM, TO)],
    ['getBodyMetricsBaseline', r => r.getBodyMetricsBaseline(USER_A)],
    ['getMostRecentConfirmedWeightKg', r => r.getMostRecentConfirmedWeightKg(USER_A)],
    ['getConfirmedScaleTrendForDate', r => r.getConfirmedScaleTrendForDate(USER_A, D)],
    ['listConfirmedScaleSamplesForDate', r => r.listConfirmedScaleSamplesForDate(USER_A, D, TZ)],
    ['listRecentDismissedScaleSamples', r => r.listRecentDismissedScaleSamples(USER_A, 50)],
    ['listPendingScaleSamples', r => r.listPendingScaleSamples(USER_A)],
    // activities, tests, running
    ['listActivityLogs', r => r.listActivityLogs(USER_A, FROM, TO)],
    ['getActivityLogById', r => r.getActivityLogById(USER_A, bId('activity_logs'))],
    ['getActiveRunningPlan', r => r.getActiveRunningPlan(USER_A)],
    ['getPrescribedRuns', r => r.getPrescribedRuns(USER_A, FROM, TO)],
    // verdicts, sleep, check-ins, panels, rest days
    ['getSleepVerdict', r => r.getSleepVerdict(USER_A, D)],
    ['getReadinessVerdict', r => r.getReadinessVerdict(USER_A, D)],
    ['getShadowReadiness', r => r.getShadowReadiness(USER_A, FROM, TO)],
    ['listBloodPanels', r => r.listBloodPanels(USER_A)],
    ['isRestDayChosen', r => r.isRestDayChosen(USER_A, D)],
    ['listRestDays', r => r.listRestDays(USER_A, FROM, TO)],
    // #2076. B's token is live (not rotated, not revoked, expiring in a month).
    ['listActiveNativeRefreshTokens', r => r.listActiveNativeRefreshTokens(USER_A)],
    // PRs and estimates
    ['getExerciseEstimates', r => r.getExerciseEstimates(USER_A)],
    ['listRecentPersonalRecords', r => r.listRecentPersonalRecords(USER_A, FROM_TS, TO_TS)],
    ['listPersonalRecordsDated', r => r.listPersonalRecordsDated(USER_A)],
    ['listMaxReps', r => r.listMaxReps(USER_A)],
    ['listLoggedExerciseNames', r => r.listLoggedExerciseNames(USER_A)],
    // goals, insights, body comp
    ['getGoalRecommendation', r => r.getGoalRecommendation(USER_A, bId('goal_recommendations'))],
    ['getAiHealthInsightWithHash', r => r.getAiHealthInsightWithHash(USER_A, bVal('ai_health_insights', 'section'), D)],
    ['listAiHealthInsightsForDate', r => r.listAiHealthInsightsForDate(USER_A, D)],
    ['getLatestDexaScan', r => r.getLatestDexaScan(USER_A)],
    ['getBodyFatCalibration', r => r.getBodyFatCalibration(USER_A)],
    ['listDexaScans', r => r.listDexaScans(USER_A)],
    ['getLatestMeasuredRmr', r => r.getLatestMeasuredRmr(USER_A)],
    ['listMeasuredRmr', r => r.listMeasuredRmr(USER_A)],
    ['getAppLoadReport', r => r.getAppLoadReport(USER_A, 3650)],
    // sync
    ['getSyncDelta', r => r.getSyncDelta(USER_A, new Date(0)), v => {
      expect(leaked(v)).toEqual([])
      const d = v as Record<string, unknown>
      for (const [k, x] of Object.entries(d)) if (Array.isArray(x)) expect([k, x]).toEqual([k, []])
    }],
    ['getSyncDelta (windowed)', r => r.getSyncDelta(USER_A, new Date(0), 3650), v => {
      expect(leaked(v)).toEqual([])
      const d = v as Record<string, unknown>
      for (const [k, x] of Object.entries(d)) if (Array.isArray(x)) expect([k, x]).toEqual([k, []])
    }],
    // Oura / ring
    ['getOuraClockAnchor', r => r.getOuraClockAnchor(USER_A)],
    ['getOuraClockAnchors', r => r.getOuraClockAnchors(USER_A)],
    ['getOuraClockOffsets', r => r.getOuraClockOffsets(USER_A)],
    ['getOuraHeartrateBySource', r => r.getOuraHeartrateBySource(USER_A, bVal('oura_heartrate', 'source'), FROM_TS, TO_TS)],
    ['getOuraDaytimeStressBuckets', r => r.getOuraDaytimeStressBuckets(USER_A, FROM_TS, TO_TS)],
    ['getLatestStrapStatus', r => r.getLatestStrapStatus(USER_A)],
    ['listStrapStatus', r => r.listStrapStatus(USER_A, FROM_TS, 50)],
    ['getOuraBatteryPolls', r => r.getOuraBatteryPolls(USER_A, FROM_TS, TO_TS)],
    ['getOuraRawSampleSummary', r => r.getOuraRawSampleSummary(USER_A)],
    ['getOuraDaily', r => r.getOuraDaily(USER_A, FROM, TO)],
    ['getLatestOuraCloudVitals', r => r.getLatestOuraCloudVitals(USER_A)],
    ['getRedecodeJob', r => r.getRedecodeJob(USER_A, bNum('oura_redecode_jobs'))],
    ['getLatestRedecodeJob', r => r.getLatestRedecodeJob(USER_A)],
    ['getPendingRekeyDeclaration', r => r.getPendingRekeyDeclaration(USER_A)],
    ['hasOuraBleSamples', r => r.hasOuraBleSamples(USER_A)],
    ['getLatestOuraBleMeasuredAt', r => r.getLatestOuraBleMeasuredAt(USER_A)],
    ['listOuraTags', r => r.listOuraTags(USER_A, FROM, TO)],
    ['getHrForWindow', r => r.getHrForWindow(USER_A, FROM_TS, TO_TS)],
    ['getObservedHrProfile', r => r.getObservedHrProfile(USER_A, FROM_TS, TO_TS)],
    ['getZoneMinutesRange', r => r.getZoneMinutesRange(USER_A, FROM, TO, TZ, { maxHr: 190, restingHr: 50 }),
      // One entry per requested day whatever the data; a leak shows as non-zero seconds.
      v => expect((v as { seconds: number[] }[]).flatMap(x => x.seconds).filter(n => n !== 0)).toEqual([])],
    ['getRrForWindow', r => r.getRrForWindow(USER_A, FROM_TS, TO_TS)],
    ['getDaytimeHrvModel', r => r.getDaytimeHrvModel(USER_A)],
    ['getAvgBpmBySession', r => r.getAvgBpmBySession(USER_A, [bId('workout_sessions')])],
    ['getWorkoutHrStats', r => r.getWorkoutHrStats(USER_A, bId('workout_sessions'))],
    ['listSessionsMissingHrStats', r => r.listSessionsMissingHrStats(USER_A, FROM_TS, 50)],
    ['getSetDetailsForSession', r => r.getSetDetailsForSession(USER_A, bId('workout_sessions'))],
    ['getSetHrStatsForSession', r => r.getSetHrStatsForSession(USER_A, bId('workout_sessions'))],
    ['getSetHrStatsForExercise', r => r.getSetHrStatsForExercise(USER_A, { exerciseName: bVal('set_hr_stats', 'exercise_name'), since: FROM_TS })],
    ['getSetHrStatsSince', r => r.getSetHrStatsSince(USER_A, FROM_TS)],
    ['listSetHrStatsForHrr1Backfill', r => r.listSetHrStatsForHrr1Backfill(USER_A)],
    ['listSessionsMissingSetHrStats', r => r.listSessionsMissingSetHrStats(USER_A, FROM_TS, 50)],
    ['getOuraWorkouts', r => r.getOuraWorkouts(USER_A, { from: FROM, to: TO, timezone: TZ })],
    ['getSetTimestampsForSession', r => r.getSetTimestampsForSession(USER_A, bId('workout_sessions'))],
    ['getUnsyncedHrSessionsForDay', r => r.getUnsyncedHrSessionsForDay(USER_A, D, TZ)],
    ['getUnsyncedHrSessions', r => r.getUnsyncedHrSessions(USER_A, FROM_TS, TO_TS)],
    ['getOuraDailySummary', r => r.getOuraDailySummary(USER_A, FROM, TO)],
    ['getOuraDailyDerived', r => r.getOuraDailyDerived(USER_A, FROM, TO)],
    ['getDerivedScoresForDay', r => r.getDerivedScoresForDay(USER_A, D)],
    ['getOuraRollupState', r => r.getOuraRollupState(USER_A)],
    ['countPackableBuckets', r => r.countPackableBuckets(USER_A)],
    ['previewStepsBackfill', r => r.previewStepsBackfill(USER_A, TZ)],
    // supplements
    ['listSupplementVials', r => r.listSupplementVials(USER_A, bId('supplements'))],
    ['currentSupplementVial', r => r.currentSupplementVial(USER_A, bId('supplements'))],
    ['listDoseEvents', r => r.listDoseEvents(USER_A, FROM, TO)],
    ['listDoseHistory', r => r.listDoseHistory(USER_A, FROM, TO)],
    // colmi, health connect
    ['getColmiReadings', r => r.getColmiReadings(USER_A, [bVal('colmi_readings', 'kind')] as never, FROM_TS, TO_TS)],
    ['getColmiSleepSegments', r => r.getColmiSleepSegments(USER_A, FROM, TO)],
    ['getColmiLatestReadingAt', r => r.getColmiLatestReadingAt(USER_A)],
    ['getHealthConnectIntervals', r => r.getHealthConnectIntervals(USER_A, bVal('health_connect_intervals', 'kind') as never, FROM_TS, TO_TS)],
    // meal plans and nutrition
    ['listMealPlans', r => r.listMealPlans(USER_A)],
    ['getActiveMealPlan', r => r.getActiveMealPlan(USER_A)],
    ['listUserDietaryRestrictions', r => r.listUserDietaryRestrictions(USER_A)],
    ['listPlanMealAnswers', r => r.listPlanMealAnswers(USER_A, D)],
    // B's active plan was generated at AT, so a 1-day threshold makes it overdue.
    ['mealPlanNeedsReview', r => r.mealPlanNeedsReview(USER_A, 1)],
    ['countLiveFoodLogsForMealType', r => r.countLiveFoodLogsForMealType(USER_A, bId('meal_types'))],
    ['foodLogRefsValid', r => r.foodLogRefsValid(USER_A, bId('meal_types'), bId('food_items'), bId('saved_meals'))],
    ['listLatestMealTimes', r => r.listLatestMealTimes(USER_A, FROM, TO)],
    ['getRequiredMealTypeLogDays', r => r.getRequiredMealTypeLogDays(USER_A, FROM, TO)],
    // periodization and programs
    ['getSessionPeriodization', r => r.getSessionPeriodization(USER_A, bId('program_sessions'))],
    ['listSessionPeriodizationForProgram', r => r.listSessionPeriodizationForProgram(USER_A, bId('programs'))],
    ['countSessionsSinceStart', r => r.countSessionsSinceStart(USER_A, bId('programs'))],
    ['countAllSessionsSinceStart', r => r.countAllSessionsSinceStart(USER_A, bId('programs'))],
    ['listPrograms', r => r.listPrograms(USER_A)],
    ['listProgramPhases', r => r.listProgramPhases(USER_A, bId('programs'))],
    ['listPhaseSets', r => r.listPhaseSets(USER_A)],
    ['listProgressionStyles', r => r.listProgressionStyles(USER_A)],
    ['progressionStyleIdsOwned', r => r.progressionStyleIdsOwned(USER_A, [bId('progression_styles')])],
    // muscle attribution (library and non-library branches both seeded for B)
    ['getWeeklySetsByMuscleGroup', r => r.getWeeklySetsByMuscleGroup(USER_A, bId('programs'), FROM, TO, TZ)],
    ['getSetsByMuscleInWindow', r => r.getSetsByMuscleInWindow(USER_A, FROM, TO, TZ)],
    ['getMuscleTonnageByWeek', r => r.getMuscleTonnageByWeek(USER_A, FROM, TO, TZ)],
    // recent food items
    ['listRecentFoodItems', r => r.listRecentFoodItems(USER_A, 20)],
    ['listRecentFoodItemsForMealType', r => r.listRecentFoodItemsForMealType(USER_A, bId('meal_types'), 20)],
    // Ring-ingest helpers that are public on the adapter but not on the repository interface.
    ['getOuraClockEpochHead', r => (r as unknown as AdapterExtras).getOuraClockEpochHead(USER_A)],
    ['getNewestOuraClockAnchorByUtc', r => (r as unknown as AdapterExtras).getNewestOuraClockAnchorByUtc(USER_A)],
    // Slice functions reached only from the rollup or from other slices, never through the
    // repository interface. Called directly against the same database.
    ['oura.getRunningRedecodeJob', async () => (await oura()).getRunningRedecodeJob(db, USER_A)],
    ['oura.listDaytimeStressBuckets', async () => (await oura()).listDaytimeStressBuckets(db, USER_A, FROM, TO)],
    ['oura.getLatestOuraDailySummaryBefore', async () => (await oura()).getLatestOuraDailySummaryBefore(db, USER_A, '2026-12-31')],
    ['oura.getOuraRollupWatermark', async () => (await oura()).getOuraRollupWatermark(db, USER_A, Number(bRow('oura_rollup_state').epoch))],
    ['oura-raw-frames.readRawFrames', async () => (await rawFrames()).readRawFrames(db, USER_A, { tags: [Number(bRow('oura_raw_samples').tag)] })],
    ['oura-raw-frames.readRecentRawFrames', async () => (await rawFrames()).readRecentRawFrames(db, USER_A, [Number(bRow('oura_raw_samples').tag)], 10)],
  ]

  for (const [name, call, check] of READERS) {
    it(`${name} returns nothing of another user's`, async () => {
      const v = await call(repo)
      if (check) { check(v); return }
      expect(leaked(v)).toEqual([])
      expect({ name, v: emptyish(v) ? 'empty' : serialise(v) }).toEqual({ name, v: 'empty' })
    })
  }

  // ---- WRITERS: aimed at B's ids, or at the date B has data on; B must be untouched ----
  // `echoes`: the method returns what A passed in (a name, an exercise), so a B string in the result
  // is the argument, not a leak — the `after` check carries the real assertion instead.
  type Writer = [name: string, call: (r: Repo) => Promise<unknown>, after?: (v: unknown) => Promise<void> | void, opts?: { echoes: true }]
  const WRITERS: Writer[] = [
    ['completeWorkoutSession', r => r.completeWorkoutSession(bOpenSession, USER_A, AT)],
    ['setSessionRpe', r => r.setSessionRpe(USER_A, bId('workout_sessions'), 9)],
    ['setWorkoutSessionWarmupEnd', r => r.setWorkoutSessionWarmupEnd(USER_A, bId('workout_sessions'), AT)],
    ['confirmScaleSample', r => r.confirmScaleSample(USER_A, bNum('scale_raw_samples'))],
    ['dismissScaleSample', r => r.dismissScaleSample(USER_A, bNum('scale_raw_samples'))],
    ['setSleepVerdictResponse', r => r.setSleepVerdictResponse(USER_A, D, 'acknowledged')],
    ['setReadinessVerdictResponse', r => r.setReadinessVerdictResponse(USER_A, D, 'rated')],
    // #2076. Aimed at B's live token and B's family. `createNativeRefreshToken` has no predicate (it
    // always starts a new family for the caller) and `findNativeRefreshTokenByHash` is the one lookup
    // that is unscoped by design, so neither has a row here.
    ['rotateNativeRefreshToken', r => r.rotateNativeRefreshToken({
      userId: USER_A, id: bId('native_refresh_tokens'),
      newTokenHash: randomBytes(32).toString('hex') as import('@/lib/auth/refresh-token-hash').RefreshTokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    }), v => { expect(v).toBeNull() }],
    ['revokeNativeRefreshToken', r => r.revokeNativeRefreshToken(USER_A, bId('native_refresh_tokens'), 'user')],
    ['revokeNativeRefreshTokenFamily', r => r.revokeNativeRefreshTokenFamily(USER_A, bVal('native_refresh_tokens', 'family_id'), 'user')],
    // #2377. No predicate for the sweep to neutralise: the conflict key (user_id, date,
    // model_version) is the guard. Aimed at B's own day and version; checked by hand to fail when the
    // upsert writes any user_id but the caller's.
    ['upsertShadowReadiness', r => r.upsertShadowReadiness(USER_A, {
      date: D, modelVersion: Number(bRow('shadow_readiness').model_version),
      shadowReadiness: 1, pillars: { sleep: 1, heart: 1, activity: 1, body: 1 }, pillarDetail: {}, units: {},
      maturityStage: 'settled', inputsThrough: null, liveReadiness: 1, liveModelVersion: 'OVERWRITTEN BY A',
      computedBy: 'replay',
    })],
    ['setManualSleepStart', r => r.setManualSleepStart(USER_A, D, AT)],
    ['deleteBloodPanel', r => r.deleteBloodPanel(USER_A, bId('blood_panels'))],
    ['setRestDay (clear)', r => r.setRestDay(USER_A, D, false)],
    ['deleteAiHealthInsight', r => r.deleteAiHealthInsight(USER_A, bVal('ai_health_insights', 'section'))],
    ['updateSupplementVial', r => r.updateSupplementVial(bId('supplement_vials'), USER_A, { notes: 'OVERWRITTEN BY A' } as never)],
    ['deleteSupplementVial', r => r.deleteSupplementVial(bId('supplement_vials'), USER_A)],
    ['cancelPendingRekeyDeclaration', r => r.cancelPendingRekeyDeclaration(USER_A)],
    ['reapStaleRedecodeJobs', r => r.reapStaleRedecodeJobs(USER_A)],
    ['markOuraWorkoutReviewed', r => r.markOuraWorkoutReviewed(USER_A, bId('oura_workouts'))],
    ['markHrSynced', r => r.markHrSynced(USER_A, bId('workout_sessions'))],
    ['writeSetHrr1', r => r.writeSetHrr1(USER_A, [{ setLogId: bId('set_logs'), hrr1Bpm: 99, restAdequate: true }])],
    ['nullHistoricalDecoded', r => r.nullHistoricalDecoded(USER_A),
      v => { expect(v).toEqual({ nulled: 0, remaining: 0 }) }],
    ['packOuraRawBuckets', r => r.packOuraRawBuckets(USER_A)],
    ['persistBodyCompFromMetrics', r => r.persistBodyCompFromMetrics(USER_A), v => { expect(v).toBe(0) }],
    ['deleteMealPlan', r => r.deleteMealPlan(bId('meal_plans'), USER_A)],
    ['updateMealPlan', r => r.updateMealPlan(bId('meal_plans'), USER_A, { name: 'OVERWRITTEN BY A' })],
    ['setMealPlanActive', r => r.setMealPlanActive(bId('meal_plans'), USER_A, true)],
    ['markMealPlanReviewed', r => r.markMealPlanReviewed(bId('meal_plans'), USER_A)],
    ['replaceMealPlanStructure', r => r.replaceMealPlanStructure(bId('meal_plans'), USER_A, {
      mealsPerDay: 3, trainingTime: null, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60, variants: [],
    })],
    ['replaceUserDietaryRestrictions', r => r.replaceUserDietaryRestrictions(USER_A, [])],
    ['savePlanMealAnswer', r => r.savePlanMealAnswer(USER_A, { planMealId: bId('meal_plan_meals'), logDate: D })],
    ['deletePlanMealAnswer', r => r.deletePlanMealAnswer(USER_A, bVal('plan_meal_answers', 'plan_meal_id'), bVal('plan_meal_answers', 'log_date'))],
    ['reassignAndDeleteMealType', r => r.reassignAndDeleteMealType(USER_A, bId('meal_types'), bId('meal_types'))],
    ['reorderMealTypes', r => r.reorderMealTypes(USER_A, [bId('meal_types')])],
    ['seedDefaultMealTypes', r => r.seedDefaultMealTypes(USER_A)],
    // createFoodLog does NOT validate refs itself — both callers run foodLogRefsValid first (row in
    // READERS). What it owns is the upsert arm: a client-supplied id that is B's log must not update it.
    ['createFoodLog replaying another user\'s log id', r => r.createFoodLog(USER_A, {
      id: bId('food_logs'), date: D, mealTypeId: bId('meal_types'), foodItemId: bId('food_items'), quantityMultiplier: 7,
    })],
    ['setBaselineComplete', r => r.setBaselineComplete(USER_A, bId('program_sessions'), {})],
    ['recordBaselineAnchors', r => r.recordBaselineAnchors(USER_A, bId('program_sessions'), {}, true)],
    ['advancePhase', r => r.advancePhase(USER_A, bId('program_sessions'), 'deload' as never)],
    ['clearProgramPrescriptions', r => r.clearProgramPrescriptions(USER_A, bId('programs'))],
    ['updatePrescriptionStatus', r => r.updatePrescriptionStatus(USER_A, bId('program_sessions'), 'expired' as never)],
    ['storePendingTransition', r => r.storePendingTransition(USER_A, bId('program_sessions'), null)],
    ['incrementSessionsInPhase', r => r.incrementSessionsInPhase(USER_A, bId('program_sessions'))],
    ['reconcileSessionsInPhase', r => r.reconcileSessionsInPhase(USER_A, bId('programs'))],
    ['setLastSessionRanPrescription', r => r.setLastSessionRanPrescription(USER_A, bId('program_sessions'), true)],
    ['revertAutoAdoptedBaseline', r => r.revertAutoAdoptedBaseline(USER_A, bId('program_sessions'))],
    ['deleteProgram', r => r.deleteProgram(USER_A, bId('programs'))],
    ['deletePhaseSet', r => r.deletePhaseSet(bId('phase_sets'), USER_A)],
    ['linkPhaseSetOwnership', r => r.linkPhaseSetOwnership(bId('phase_sets'), bId('programs'), USER_A)],
    ['updateProgramPhaseSettings', r => r.updateProgramPhaseSettings(bId('programs'), USER_A, { sessionsPerCycle: 99 })],
    ['autoRecalibrateCycleAnchor', r => r.autoRecalibrateCycleAnchor(USER_A, bId('programs'))],
    ['confirmEarlyDeload', r => r.confirmEarlyDeload(USER_A, bId('programs'), D, TZ)],
    ['deleteProgressionStyle', r => r.deleteProgressionStyle(USER_A, bId('progression_styles'))],
    ['reconcileUserStats', r => r.reconcileUserStats(USER_A), async () => {
      const { rows } = await pool.query(`SELECT * FROM user_stats WHERE user_id = $1`, [USER_A])
      expect(leaked(rows)).toEqual([])
      for (const row of rows) {
        for (const [k, x] of Object.entries(row)) if (typeof x === 'number') expect([k, x]).toEqual([k, 0])
      }
    }],
    // ---- client-supplied ids on upserts: an id that is B's must never update B's row ----
    ['saveActivityLog (overwrite) with another user\'s id', r => r.saveActivityLog(USER_A, {
      id: bId('activity_logs'), date: D, activityType: 'walk', title: 'OVERWRITTEN BY A',
    } as never, { overwrite: true })],
    ['saveActivityLog (first-write-wins) with another user\'s id', r => r.saveActivityLog(USER_A, {
      id: bId('activity_logs'), date: D, activityType: 'walk', title: 'A',
    } as never)],
    ['saveFitnessTest with another user\'s id', r => r.saveFitnessTest(USER_A, {
      id: bId('fitness_tests'), testType: 'cooper', date: D,
    } as never)],
    ['createInjury with another user\'s id', r => r.createInjury(USER_A, {
      id: bId('injuries'), muscleName: 'OVERWRITTEN BY A', notes: null, severity: 'mild', startedDate: D, resolvedDate: null,
    })],
    ['createSupplement with another user\'s id', r => r.createSupplement(USER_A, {
      id: bId('supplements'), name: 'OVERWRITTEN BY A', dose: null,
    } as never)],
    ['createFoodItem with another user\'s id', r => r.createFoodItem(USER_A, {
      id: bId('food_items'), name: 'A', calories: 1, proteinG: 1, carbsG: 1, fatG: 1, servingSizeG: 100, region: 'AU', source: 'manual',
    } as never)],
    ['createFoodItem (reuseExisting) does not hand back another user\'s item', r => r.createFoodItem(USER_A, {
      name: bVal('food_items', 'name'), calories: Number(bRow('food_items').calories), proteinG: Number(bRow('food_items').protein_g),
      carbsG: Number(bRow('food_items').carbs_g), fatG: Number(bRow('food_items').fat_g),
      servingSizeG: Number(bRow('food_items').serving_size_g), region: 'AU', source: 'manual',
    } as never, { reuseExisting: true }), v => { expect((v as { id: string }).id).not.toBe(bId('food_items')) }, { echoes: true }],
    ['insertScaleRawSample does not dedupe against another user\'s sample', r => r.insertScaleRawSample(USER_A, {
      measuredAt: bRow('scale_raw_samples').measured_at as Date, rawHex: bVal('scale_raw_samples', 'raw_hex'),
      decoded: null, status: 'pending',
    } as never), v => { expect((v as { id: number }).id).not.toBe(bNum('scale_raw_samples')) }],
    // ---- "deactivate the others" sweeps must be scoped to the caller ----
    ['saveRunningPlan leaves another user\'s active plan active', r => r.saveRunningPlan(USER_A, {
      goalKind: 'general', targetDistanceKm: null, targetDate: null, frameworkKey: 'base', fitnessSnapshot: {},
      timePerSessionMinutes: null, isActive: true,
    } as never)],
    ['createMealPlan (activate) leaves another user\'s active plan active', r => r.createMealPlan(USER_A, {
      name: 'A PLAN', mealsPerDay: 3, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
      variants: [], activate: true,
    })],
    // ---- parent ownership pre-checks on client-supplied parent ids ----
    ['logSupplement against another user\'s supplement', r => r.logSupplement(bId('supplements'), USER_A, '2026-09-20'),
      async () => {
        const { rows } = await pool.query(`SELECT id FROM supplement_logs WHERE user_id = $1`, [USER_A])
        expect(rows).toEqual([])
      }],
    ['createSupplementVial against another user\'s supplement', r => r.createSupplementVial(USER_A, {
      supplementId: bId('supplements'), strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: D,
    }), async () => {
      const { rows } = await pool.query(`SELECT id FROM supplement_vials WHERE user_id = $1`, [USER_A])
      expect(rows).toEqual([])
    }],
    ['createMealPlan naming another user\'s meal type', r => r.createMealPlan(USER_A, {
      name: 'A PLAN REF MT', mealsPerDay: 1, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
      variants: [{ dayType: 'all', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
        meals: [{ ...MEAL, mealTypeId: bId('meal_types') }] }] as never,
    }), async () => {
      const { rows } = await pool.query(`SELECT id FROM meal_plans WHERE user_id = $1 AND name = 'A PLAN REF MT'`, [USER_A])
      expect(rows).toEqual([])
    }],
    ['createMealPlan naming another user\'s saved meal', r => r.createMealPlan(USER_A, {
      name: 'A PLAN REF SM', mealsPerDay: 1, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
      variants: [{ dayType: 'all', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
        meals: [{ ...MEAL, savedMealId: bId('saved_meals') }] }] as never,
    }), async () => {
      const { rows } = await pool.query(`SELECT id FROM meal_plans WHERE user_id = $1 AND name = 'A PLAN REF SM'`, [USER_A])
      expect(rows).toEqual([])
    }],
    // ---- PR bookkeeping: B's 999 kg must not be read as A's best ----
    // Before the upsert below, while A has no PR of its own for this name: the only right answer is none.
    ['applyLbsToKgFix does not read another user\'s PR', r => r.applyLbsToKgFix(USER_A, [bVal('personal_records', 'exercise_name')], TO),
      v => { expect((v as { exercises: { oldPersonalRecord?: number | null }[] }).exercises[0]?.oldPersonalRecord ?? null).toBeNull() },
      { echoes: true }],
    ['upsertPersonalRecordIfBetter compares only against the caller\'s own PR', r => r.upsertPersonalRecordIfBetter(USER_A, bVal('personal_records', 'exercise_name'), 500),
      v => { expect(v).toBe(true) }],
    // A has a profile (age, sex) but no weight; B has 80 kg. Only B's weight could yield an estimate.
    ['saveActivityLog derives energy from the caller\'s own weight only', r => r.saveActivityLog(USER_A, {
      date: '2026-09-22', activityType: 'walk', title: 'A WALK', durationMin: 60,
    } as never), v => { expect((v as { caloriesBurned?: number }).caloriesBurned ?? null).toBeNull() }],
    // ---- periodization writes keyed by a client-supplied program-session id ----
    ['storePrescription', r => r.storePrescription(USER_A, bId('program_sessions'), { phase: 'deload' } as never, AT)],
    ['updatePrescriptionExercisesCache', r => r.updatePrescriptionExercisesCache(USER_A, bId('program_sessions'), { phase: 'deload' } as never)],
    // ---- maintenance sweeps scoped to the caller ----
    ['dropZoneMinutesFrom', r => r.dropZoneMinutesFrom(USER_A, FROM)],
    ['insertOuraAccelChunk (its retention prune)', async r => {
      // FROM_TS, not AT: A's own session below spans AT and must see no chunk of A's either.
      const v = await r.insertOuraAccelChunk(USER_A, { startedAt: FROM_TS, sampleRate: 1, magnitudes: [1], steps: 0 })
      // The prune is fire-and-forget; give it a moment to land before B's rows are compared.
      await new Promise(res => setTimeout(res, 500))
      return v
    }],
    ['oura.replaceDaytimeStressBuckets', async () => (await oura()).replaceDaytimeStressBuckets(db, USER_A, D, [])],
    // An empty list returns before the delete, so the row is what makes the delete run at all.
    ['replaceOuraDailySummary', r => r.replaceOuraDailySummary(USER_A, [{ date: D } as never])],
  ]

  for (const [name, call, after, opts] of WRITERS) {
    it(`${name} cannot touch another user's rows`, async () => {
      const before = await snapshotB()
      // A rejection is a fine answer (and its message may name the id A sent); a resolved value
      // must not carry anything of B's.
      const v = await call(repo).catch(() => undefined)
      if (!opts?.echoes) expect(leaked(v)).toEqual([])
      expect(await snapshotB()).toBe(before)
      if (after) await after(v)
    })
  }

  // ---- Predicates only reachable once A owns something ----
  //
  // A layered check (look the row up scoped, THEN act) cannot be probed with B's ids alone: the
  // first scoped lookup fails, and the second predicate is never reached. These cases give A its own
  // rows so the predicate under test is the one that decides. They run after READERS and WRITERS on
  // purpose — every reader above relies on A owning nothing.
  describe('with rows of A\'s own', () => {
    const a: Record<string, string> = {}

    beforeAll(async () => {
      const ins = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0]?.id as string
      a.mealType = await ins(
        `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled, time_start_hour, time_end_hour)
         VALUES ($1, 'A OWN TYPE', 'x', 0, false, false, 6, 10) RETURNING id`, [USER_A])
      a.mealType2 = await ins(
        `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled, time_start_hour, time_end_hour)
         VALUES ($1, 'A OWN TYPE 2', 'x', 1, false, false, 12, 14) RETURNING id`, [USER_A])
      a.foodItem = await ins(
        `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, region, source)
         VALUES ($1, 'A OWN OATS', 380, 13, 67, 7, 100, 'AU', 'manual') RETURNING id`, [USER_A])
      a.foodLog = await ins(
        `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, now()) RETURNING id`, [USER_A, D, a.mealType, a.foodItem, AT])
      a.savedMeal = await ins(`INSERT INTO saved_meals (user_id, name) VALUES ($1, 'A OWN MEAL') RETURNING id`, [USER_A])
      a.supplement = await ins(
        `INSERT INTO supplements (user_id, name, dose, sort_order, active, updated_at)
         VALUES ($1, 'A OWN CREATINE', '5g', 0, true, now()) RETURNING id`, [USER_A])
      a.workoutSession = await ins(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'A OWN SESSION', $2, $3) RETURNING id`,
        [USER_A, new Date(AT.getTime() - 3_600_000), new Date(AT.getTime() + 7_200_000)])
      a.phaseSet = await ins(
        `INSERT INTO phase_sets (user_id, name, is_default) VALUES ($1, 'A OWN PHASES', false) RETURNING id`, [USER_A])
      await pool.query(
        `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, primary_style_id)
         VALUES ($1, 0, 'A OWN PHASE', 4, 'normal', $2)`, [a.phaseSet, bId('progression_styles')])
      a.program = await ins(
        `INSERT INTO programs (user_id, name, is_active, phase_mode) VALUES ($1, 'A OWN PROGRAM', false, 'manual') RETURNING id`, [USER_A])
    })

    it('foodLogRefsValid rejects another user\'s meal type next to the caller\'s own food item', async () => {
      expect(await repo.foodLogRefsValid(USER_A, bId('meal_types'), a.foodItem)).toBe(false)
    })

    it('getLatestOuraBleMeasuredAt does not date the caller\'s ring from another user\'s samples', async () => {
      // A needs an anchor of its own, or there is nothing to convert B's ring clock with.
      const anchor = bRow('oura_ble_clock_anchors')
      const { rows: [mine] } = await pool.query(
        `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch) VALUES ($1, $2, $3, $4) RETURNING id`,
        [USER_A, anchor.anchor_ds, anchor.anchor_utc, anchor.epoch])
      try {
        expect(await repo.getLatestOuraBleMeasuredAt(USER_A)).toBeNull()
      } finally {
        await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE id = $1`, [mine.id])
      }
    })

    it('listSessionsMissing{,Set}HrStats list none of another user\'s sessions', async () => {
      // A has a heart-rate reading (so "after A's first reading" is satisfiable) and B has a
      // completed session with no stats of either kind — the shape both lists exist to find.
      const { rows: [hr] } = await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, 60, 'ble') RETURNING id`,
        [USER_A, new Date(AT.getTime() - 86_400_000)])
      const { rows: [ws] } = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'B BARE SESSION', $2, $3) RETURNING id`, [USER_B, AT, new Date(AT.getTime() + 3_600_000)])
      const { rows: [el] } = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, 'B BARE LIFT', $2) RETURNING id`,
        [ws.id, AT])
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 50, 5)`, [el.id])
      try {
        const missing = await repo.listSessionsMissingHrStats(USER_A, FROM_TS, 50)
        const missingSet = await repo.listSessionsMissingSetHrStats(USER_A, FROM_TS, 50)
        expect([...missing, ...missingSet].map(x => x.id)).not.toContain(ws.id)
      } finally {
        await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [ws.id])
        await pool.query(`DELETE FROM oura_heartrate WHERE id = $1`, [hr.id])
      }
    })

    it('foodLogRefsValid rejects another user\'s food item next to the caller\'s own meal type', async () => {
      expect(await repo.foodLogRefsValid(USER_A, a.mealType, bId('food_items'))).toBe(false)
    })

    it('foodLogRefsValid rejects another user\'s saved meal next to the caller\'s own refs', async () => {
      expect(await repo.foodLogRefsValid(USER_A, a.mealType, a.foodItem, bId('saved_meals'))).toBe(false)
      // …and the permit path, so a check that refused everything could not pass the line above.
      expect(await repo.foodLogRefsValid(USER_A, a.mealType, a.foodItem, a.savedMeal)).toBe(true)
    })

    it('reassignAndDeleteMealType refuses a destination meal type the caller does not own', async () => {
      await expect(repo.reassignAndDeleteMealType(USER_A, a.mealType, bId('meal_types'))).rejects.toThrow()
      const { rows } = await pool.query(`SELECT meal_type_id FROM food_logs WHERE id = $1`, [a.foodLog])
      expect(rows[0].meal_type_id).toBe(a.mealType)
    })

    it('reassignAndDeleteMealType moves nothing of another user\'s and deletes nothing of theirs', async () => {
      const before = await snapshotB()
      const res = await repo.reassignAndDeleteMealType(USER_A, bId('meal_types'), a.mealType2).catch(() => ({ moved: 0 }))
      expect(res.moved).toBe(0)
      expect(await snapshotB()).toBe(before)
    })

    it('reorderMealTypes refuses an order that names another user\'s meal type', async () => {
      expect(await repo.reorderMealTypes(USER_A, [a.mealType, a.mealType2, bId('meal_types')])).toBe(false)
    })

    it('createFoodLog resolves the eaten-at time only from the caller\'s own meal type', async () => {
      // B's meal type has a window the instant does not fall in; read unscoped, it would move it.
      const log = await repo.createFoodLog(USER_A, {
        date: D, mealTypeId: bId('meal_types'), foodItemId: a.foodItem, quantityMultiplier: 1, loggedAt: AT,
      })
      expect(new Date(log.loggedAt as unknown as string).getTime()).toBe(AT.getTime())
      await pool.query(`DELETE FROM food_logs WHERE id = $1`, [log.id])
    })

    it('createSavedMeal refuses another user\'s food item', async () => {
      await expect(repo.createSavedMeal(USER_A, 'A MEAL WITH B ITEM', [{ foodItemId: bId('food_items'), quantityMultiplier: 1 }]))
        .rejects.toThrow()
      const { rows } = await pool.query(`SELECT id FROM saved_meals WHERE user_id = $1 AND name = 'A MEAL WITH B ITEM'`, [USER_A])
      expect(rows).toEqual([])
    })

    it('createSavedMeal refuses another user\'s meal type as a tag', async () => {
      await expect(repo.createSavedMeal(USER_A, 'A MEAL WITH B TAG', [], undefined, 1, undefined, [bId('meal_types')]))
        .rejects.toThrow()
      const { rows } = await pool.query(`SELECT id FROM saved_meals WHERE user_id = $1 AND name = 'A MEAL WITH B TAG'`, [USER_A])
      expect(rows).toEqual([])
    })

    it('listSavedMeals does not date the caller\'s meal from another user\'s log of it', async () => {
      // The FK does not stop B's row naming A's meal — which is why the read is scoped as well.
      const { rows: [log] } = await pool.query(
        `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at, updated_at, saved_meal_id)
         VALUES ($1, $2, $3, $4, 1, $5, now(), $6) RETURNING id`,
        [USER_B, D, bId('meal_types'), bId('food_items'), AT, a.savedMeal])
      try {
        const meals = await repo.listSavedMeals(USER_A)
        expect(meals.find(m => m.id === a.savedMeal)?.lastUsedAt ?? null).toBeNull()
      } finally {
        await pool.query(`DELETE FROM food_logs WHERE id = $1`, [log.id])
      }
    })

    it('listSupplements does not mark the caller\'s supplement taken from another user\'s log', async () => {
      const { rows: [log] } = await pool.query(
        `INSERT INTO supplement_logs (user_id, supplement_id, log_date, amount, unit, updated_at)
         VALUES ($1, $2, $3, 5, 'mg', now()) RETURNING id`, [USER_B, a.supplement, '2026-09-21'])
      try {
        const list = await repo.listSupplements(USER_A, '2026-09-21')
        const mine = list.find(x => x.id === a.supplement)!
        expect(mine.loggedToday).toBe(false)
        expect(serialise(mine)).not.toContain('"amount":5')
      } finally {
        await pool.query(`DELETE FROM supplement_logs WHERE id = $1`, [log.id])
      }
    })

    it('setMealPlanActive leaves another user\'s active plan active', async () => {
      const plan = await repo.createMealPlan(USER_A, {
        name: 'A OWN PLAN', mealsPerDay: 1, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60, variants: [],
      })
      const before = await snapshotB()
      await repo.setMealPlanActive(plan.id, USER_A, true)
      expect(await snapshotB()).toBe(before)
    })

    it('getWorkoutSensorProbe counts only the caller\'s own ring samples in its window', async () => {
      // A's session spans AT; B has an accel chunk and a heart-rate sample at AT.
      const probe = await repo.getWorkoutSensorProbe(USER_A, a.workoutSession)
      expect(probe).not.toBeNull()
      expect({ chunks: probe!.accel.chunks, hr: probe!.hrSamples }).toEqual({ chunks: 0, hr: 0 })
    })

    it('listSessionsMissingHrStats does not date the caller\'s ring history from another user\'s', async () => {
      // A has no heart-rate rows at all, so no session of A's can be "after the first reading".
      expect(await repo.listSessionsMissingHrStats(USER_A, FROM_TS, 50)).toEqual([])
      expect(await repo.listSessionsMissingSetHrStats(USER_A, FROM_TS, 50)).toEqual([])
    })

    it('listPhaseSets does not name another user\'s progression style on the caller\'s phase', async () => {
      // The borrowed id itself is in A's own row (that is the write-path bug RV-32 guards against
      // separately); what must not come back is B's style NAME.
      const sets = await repo.listPhaseSets(USER_A)
      expect(serialise(sets)).not.toContain(bVal('progression_styles', 'name'))
    })

    it('linkPhaseSetOwnership cannot attach another user\'s phase set to the caller\'s program', async () => {
      const before = await snapshotB()
      await repo.linkPhaseSetOwnership(bId('phase_sets'), a.program, USER_A)
      expect(await snapshotB()).toBe(before)
    })

    it('saveProgram does not treat another user\'s program name as a clash', async () => {
      const saved = await repo.saveProgram(USER_A, {
        id: '', userId: USER_A, name: bVal('programs', 'name'), isActive: false,
        sessions: [], createdAt: new Date(), updatedAt: new Date(),
        phaseMode: 'manual', trainingGoal: 'strength', autoApplyPrescriptions: false,
      } as never)
      expect(saved.name).toBe(bVal('programs', 'name'))
    })

    it('saveProgram (active) leaves another user\'s active program active', async () => {
      await pool.query(`UPDATE programs SET is_active = true WHERE id = $1`, [bId('programs')])
      const before = await snapshotB()
      await repo.saveProgram(USER_A, {
        id: '', userId: USER_A, name: 'A ACTIVE PROGRAM', isActive: true,
        sessions: [], createdAt: new Date(), updatedAt: new Date(),
        phaseMode: 'manual', trainingGoal: 'strength', autoApplyPrescriptions: false,
      } as never)
      expect(await snapshotB()).toBe(before)
    })

    it('seedDefaultMealTypes still seeds a user whose only peer has meal types', async () => {
      // C has nothing; B has meal types. Read unscoped, "has this user ever been seeded" says yes.
      const C = '00000000-0000-4000-8000-00000242a5c0'
      await pool.query(`DELETE FROM users WHERE id = $1`, [C])
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'ownership-sweep-2425-c@example.com', 'x', $2)`, [C, TZ])
      try {
        await repo.seedDefaultMealTypes(C)
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM meal_types WHERE user_id = $1`, [C])
        expect(rows[0].n).toBeGreaterThan(0)
      } finally {
        await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [C])
        await pool.query(`DELETE FROM users WHERE id = $1`, [C])
      }
    })

    it('getLatestOuraBleMeasuredAt converts the caller\'s ring clock only with the caller\'s own anchors', async () => {
      // A has a sample and no anchor: unconvertible, so null. B's anchor must not make it convertible.
      const { rows: [mine] } = await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex)
         VALUES ($1, $2, $3, 'a-own', '00') RETURNING id`,
        [USER_A, Number(bRow('oura_ble_clock_anchors').anchor_ds), Number(bRow('oura_raw_samples').tag)])
      try {
        expect(await repo.getLatestOuraBleMeasuredAt(USER_A)).toBeNull()
      } finally {
        await pool.query(`DELETE FROM oura_raw_samples WHERE id = $1`, [mine.id])
      }
    })

    it('getObservedHrProfile drops the caller\'s samples only for the caller\'s own better sources', async () => {
      // A has one aggregator sample and one ring sample. B has a device sample and a chest-strap
      // sample at the same instants — read unscoped, they would displace both of A's.
      const { AGGREGATOR_HR_SOURCES } = await import('@trainingai/shared/health/hr-window-merge')
      const t1 = new Date(AT.getTime() + 600_000)
      const t2 = new Date(AT.getTime() + 1_200_000)
      const ids: string[] = []
      const add = async (user: string, at: Date, bpm: number, source: string) => {
        const { rows: [r] } = await pool.query(
          `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, $3, $4) RETURNING id`,
          [user, at, bpm, source])
        ids.push(r.id)
      }
      try {
        await add(USER_A, t1, 90, AGGREGATOR_HR_SOURCES[0])
        await add(USER_A, t2, 95, 'ble')
        const alone = await repo.getObservedHrProfile(USER_A, FROM_TS, TO_TS)
        await add(USER_B, t1, 150, 'ble')
        await add(USER_B, t2, 155, 'chest_strap')
        expect(await repo.getObservedHrProfile(USER_A, FROM_TS, TO_TS)).toEqual(alone)
      } finally {
        await pool.query(`DELETE FROM oura_heartrate WHERE id = ANY($1::uuid[])`, [ids])
      }
    })

    it('countSessionsSinceStart reads the anchor only from the caller\'s own program', async () => {
      // B's program starts 2026-09-20, after every session of A's. Read unscoped, A's count drops.
      await pool.query(`UPDATE programs SET started_at = '2026-09-20' WHERE id = $1`, [bId('programs')])
      const unknownProgram = '00000000-0000-4000-8000-0000000242ff'
      expect(await repo.countSessionsSinceStart(USER_A, bId('programs')))
        .toBe(await repo.countSessionsSinceStart(USER_A, unknownProgram))
      expect(await repo.countSessionsSinceStart(USER_A, unknownProgram)).toBeGreaterThan(0)
    })

    it('autoRecalibrateCycleAnchor counts and orders only the caller\'s own sessions', async () => {
      // A has 3 sessions; the block is A's count + B's count long. Scoped, n = 3 and A has no 4th
      // session, so the anchor is just before A's oldest (AT − 3 h − 1 s). Counting B's sessions
      // makes n = 0 (anchor = now); ordering B's in (they are newer than all of A's) makes the 4th
      // most recent one of A's. Sized from B's live count so an extra B fixture row cannot make the
      // two coincide — which is exactly how this case went blind once already.
      const { rows: [{ n: bSessions }] } = await pool.query(
        `SELECT count(*)::int AS n FROM workout_sessions WHERE user_id = $1 AND NOT is_early_deload AND deleted_at IS NULL`, [USER_B])
      const set = (await pool.query(
        `INSERT INTO phase_sets (user_id, name, is_default) VALUES ($1, 'A BLOCK', false) RETURNING id`, [USER_A])).rows[0].id
      await pool.query(
        `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type) VALUES ($1, 0, 'P', $2, 'normal')`,
        [set, 3 + bSessions])
      const prog = (await pool.query(
        `INSERT INTO programs (user_id, name, is_active, phase_mode, phase_set_id, sessions_per_cycle)
         VALUES ($1, 'A CYCLE PROGRAM', false, 'automatic', $2, 1) RETURNING id`, [USER_A, set])).rows[0].id
      const extra = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES
           ($1, 'A EXTRA 2', $2), ($1, 'A EXTRA 3', $3) RETURNING id`,
        [USER_A, new Date(AT.getTime() - 7_200_000), new Date(AT.getTime() - 10_800_000)])).rows.map(r => r.id)
      try {
        await repo.autoRecalibrateCycleAnchor(USER_A, prog)
        const { rows: [p] } = await pool.query(`SELECT cycle_anchor_at FROM programs WHERE id = $1`, [prog])
        expect(new Date(p.cycle_anchor_at).getTime()).toBe(AT.getTime() - 10_800_000 - 1000)
      } finally {
        await pool.query(`DELETE FROM workout_sessions WHERE id = ANY($1::uuid[])`, [extra])
        await pool.query(`DELETE FROM programs WHERE id = $1`, [prog])
        await pool.query(`DELETE FROM phase_sets WHERE id = $1`, [set])
      }
    })

    it('saveProgram renames only the caller\'s own phase set when it renames the program', async () => {
      // B's phase set names A's program as its owner — the FK proves the program exists, not whose.
      const orig = bRow('phase_sets')
      await pool.query(`UPDATE phase_sets SET owner_program_id = $1, template_base_name = 'B TEMPLATE' WHERE id = $2`,
        [a.program, bId('phase_sets')])
      try {
        const before = await snapshotB()
        await repo.saveProgram(USER_A, {
          id: a.program, userId: USER_A, name: 'A OWN PROGRAM RENAMED', isActive: false,
          sessions: [], createdAt: new Date(), updatedAt: new Date(),
          phaseMode: 'manual', trainingGoal: 'strength', autoApplyPrescriptions: false,
        } as never)
        expect(await snapshotB()).toBe(before)
      } finally {
        await pool.query(`UPDATE phase_sets SET owner_program_id = $1, template_base_name = $2, name = $3 WHERE id = $4`,
          [orig.owner_program_id, orig.template_base_name, orig.name, bId('phase_sets')])
      }
    })

    it('deletePhaseSet is not blocked — or answered with a name — by another user\'s program', async () => {
      const set = (await pool.query(
        `INSERT INTO phase_sets (user_id, name, is_default) VALUES ($1, 'A SET B POINTS AT', false) RETURNING id`, [USER_A])).rows[0].id
      await pool.query(`UPDATE programs SET phase_set_id = $1 WHERE id = $2`, [set, bId('programs')])
      const err = await repo.deletePhaseSet(set, USER_A).then(() => null, (e: unknown) => String(e))
      expect(err).toBeNull()
    })

    // ---- #2570: predicates that decide nothing until A owns specific data ----

    it('getNextSession does not count another user\'s session today as the caller\'s', async () => {
      // A's active program has two sessions; B trained the second one's NAME today. Read unscoped,
      // B's session is the newest with a logged exercise, so A is told it already trained.
      const shared = 'SHARED NAME 2570'
      await pool.query(`UPDATE programs SET is_active = false WHERE user_id = $1`, [USER_A])
      const prog = (await pool.query(
        `INSERT INTO programs (user_id, name, is_active, phase_mode) VALUES ($1, 'A NEXT PROGRAM 2570', true, 'manual') RETURNING id`,
        [USER_A])).rows[0].id
      await pool.query(
        `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'A FIRST 2570', 0), ($1, $2, 1)`, [prog, shared])
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, $2, now()) RETURNING id`,
        [USER_B, shared])).rows[0].id
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, 'B TODAY LIFT 2570', now())`, [ws])
      try {
        const next = await repo.getNextSession(USER_A, TZ)
        expect(next.reason).not.toMatch(/Already trained/)
        expect(next.session?.name).not.toBe(shared)
      } finally {
        await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [ws])
        await pool.query(`DELETE FROM programs WHERE id = $1`, [prog])
      }
    })

    it('getBodyFatCalibration pairs only the caller\'s own scans with the caller\'s own readings', async () => {
      // A: a scan on 08-10 paired with a scale reading on 08-11 (offset +2), and a spare reading on
      // 08-20 with no scan. B: a scan on 08-20 (pairs with A's spare reading if scans are read
      // unscoped) and a same-day, same-source reading on 08-10 (displaces A's if readings are).
      const bm = (user: string, date: string, pct: number) => pool.query(
        `INSERT INTO body_metrics (user_id, date, body_fat_pct, source_map) VALUES ($1, $2, $3, $4) RETURNING id`,
        [user, date, pct, JSON.stringify({ body_fat_pct: 'scale_ble' })]).then(r => r.rows[0].id as string)
      const scan = (user: string, date: string, pct: number) => pool.query(
        `INSERT INTO dexa_scans (user_id, scanned_on, pct_fat) VALUES ($1, $2, $3) RETURNING id`,
        [user, date, pct]).then(r => r.rows[0].id as string)
      const metrics: string[] = []
      const scans: string[] = []
      try {
        scans.push(await scan(USER_A, '2026-08-10', 20))
        metrics.push(await bm(USER_A, '2026-08-11', 18), await bm(USER_A, '2026-08-20', 25))
        const alone = await repo.getBodyFatCalibration(USER_A)
        expect(alone?.offsetPct).toBe(2)
        expect(alone?.pairs).toHaveLength(1)
        scans.push(await scan(USER_B, '2026-08-20', 40))
        metrics.push(await bm(USER_B, '2026-08-10', 10))
        expect(await repo.getBodyFatCalibration(USER_A)).toEqual(alone)
      } finally {
        await pool.query(`DELETE FROM body_metrics WHERE id = ANY($1::uuid[])`, [metrics])
        await pool.query(`DELETE FROM dexa_scans WHERE id = ANY($1::uuid[])`, [scans])
      }
    })

    it('previewStepsBackfill builds step days only from the caller\'s own windows and stored days', async () => {
      // A: a clock anchor at noon 08-25 and a 600-step live window there, no stored day — one row
      // to preview. B: a live window one ring-day earlier (a second row if windows are read
      // unscoped) and a manual 08-25 day (outranks the ring, so the row vanishes if days are).
      const anchorUtc = new Date('2026-08-25T02:00:00Z')
      const ds = 1_000_000
      const anchor = (await pool.query(
        `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch) VALUES ($1, $2, $3, 0) RETURNING id`,
        [USER_A, ds, anchorUtc])).rows[0].id
      const windows = (await pool.query(
        `INSERT INTO step_live_windows (user_id, start_ds, end_ds, steps) VALUES ($1, $3, $4, 600), ($2, $5, $6, 600) RETURNING id`,
        [USER_A, USER_B, ds, ds + 6000, ds - 864_000, ds - 864_000 + 6000])).rows.map(r => r.id)
      const day = (await pool.query(
        `INSERT INTO body_metrics (user_id, date, steps, source_map) VALUES ($1, '2026-08-25', 9000, $2) RETURNING id`,
        [USER_B, JSON.stringify({ steps: 'manual' })])).rows[0].id
      try {
        expect(await repo.previewStepsBackfill(USER_A, TZ))
          .toEqual([{ date: '2026-08-25', oldSteps: 0, oldSource: null, newSteps: 600 }])
      } finally {
        await pool.query(`DELETE FROM body_metrics WHERE id = $1`, [day])
        await pool.query(`DELETE FROM step_live_windows WHERE id = ANY($1::bigint[])`, [windows])
        await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE id = $1`, [anchor])
      }
    })

    it('getOuraRawSampleSummary dates the caller\'s history from the caller\'s own packed tier only', async () => {
      // A has one hot frame, so the summary has an anchor to date ds with; B has a packed bucket
      // far older. Read unscoped, B's span would become the start of A's history.
      const hot = (await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex) VALUES ($1, 2000000, 70, 'a-hot-2570', '0102') RETURNING id`,
        [USER_A])).rows[0].id
      await pool.query(
        `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
         VALUES ($1, 0, 70, 0, 1, 1000, 1000, 'b-2570', '\\x00')`, [USER_B])
      try {
        const sum = await repo.getOuraRawSampleSummary(USER_A)
        expect(sum.newestMeasuredAt).not.toBeNull()
        expect(sum.oldestMeasuredAt).toBe(sum.newestMeasuredAt)
      } finally {
        await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1 AND body_sha256 = 'b-2570'`, [USER_B])
        await pool.query(`DELETE FROM oura_raw_samples WHERE id = $1`, [hot])
      }
    })

    it('packOuraRawBuckets seals, packs, verifies and counts only the caller\'s own buckets', async () => {
      // Ring ds: one bucket is 864,000 ds and the hot window 6,048,000. Old rows were received two
      // days ago (past the quiet guard); the newest of each user just now (inside it).
      //   A: newest in bucket 100; an old frame in bucket 50 (sealed: the one bucket to pack);
      //      an old frame in bucket 95 (inside A's hot window, so it stays hot).
      //   B: newest in bucket 200 (seals A's bucket 95 if "newest" is read unscoped); an old frame
      //      in A's bucket 50 (packed with A's if the bucket's rows are); an old B-only bucket 10
      //      (left "remaining" if eligibility is); a junk blob at A's bucket key (refuses A's
      //      bucket if the read-back is).
      const SPAN = 864_000
      const old = new Date(Date.now() - 2 * 86_400_000)
      const frame = (user: string, ds: number, at: Date | null) => pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, recorded_at, epoch)
         VALUES ($1, $2, 70, 'pack-2570', '0102', coalesce($3, now()), 0) RETURNING id`, [user, ds, at]).then(r => r.rows[0].id as string)
      const aNewest = await frame(USER_A, 100 * SPAN + 10, null)
      const aSealed = await frame(USER_A, 50 * SPAN + 5, old)
      const aWarm = await frame(USER_A, 95 * SPAN + 5, old)
      await frame(USER_B, 200 * SPAN, null)
      await frame(USER_B, 50 * SPAN + 7, old)
      await frame(USER_B, 10 * SPAN + 5, old)
      await pool.query(
        `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
         VALUES ($1, 0, 70, 50, 99, $2, $2, 'b-junk-2570', '\\x00')`, [USER_B, 50 * SPAN])
      try {
        const before = await snapshotB()
        const res = await repo.packOuraRawBuckets(USER_A)
        expect({ packed: res.packed, refused: res.refused, framesMoved: res.framesMoved, remaining: res.remaining })
          .toEqual({ packed: 1, refused: 0, framesMoved: 1, remaining: 0 })
        const { rows: hotLeft } = await pool.query(
          `SELECT id::text FROM oura_raw_samples WHERE user_id = $1 AND event_name = 'pack-2570' ORDER BY id`, [USER_A])
        expect(hotLeft.map(r => r.id)).toEqual([aNewest, aWarm].sort((x, y) => Number(x) - Number(y)))
        expect(hotLeft.map(r => r.id)).not.toContain(aSealed)
        expect(await snapshotB()).toBe(before)
      } finally {
        await pool.query(`DELETE FROM oura_raw_samples WHERE event_name = 'pack-2570' AND user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
        await pool.query(`DELETE FROM oura_raw_packed WHERE tag = 70 AND user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
      }
    })

    it('countAllSessionsSinceStart takes the start anchor only from the caller\'s own program', async () => {
      // A trained twice, before B's program started, under the name of B's program session. Given
      // B's program id, B's start date must not filter A's history; read unscoped, it drops to 0.
      // (That the result is keyed by B's session ids at all is the §5 shape of the 2026-10-07
      // review: no caller passes a foreign program id.)
      const orig = bRow('programs')
      await pool.query(`UPDATE programs SET started_at = '2026-09-20', cycle_anchor_at = NULL WHERE id = $1`, [bId('programs')])
      const mine = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, $2, $3), ($1, $2, $4) RETURNING id`,
        [USER_A, bVal('program_sessions', 'name'), AT, new Date(AT.getTime() - 86_400_000)])).rows.map(r => r.id)
      try {
        const counts = await repo.countAllSessionsSinceStart(USER_A, bId('programs'))
        expect([...counts.values()].reduce((x, y) => x + y, 0)).toBe(2)
      } finally {
        await pool.query(`DELETE FROM workout_sessions WHERE id = ANY($1::uuid[])`, [mine])
        await pool.query(`UPDATE programs SET started_at = $1, cycle_anchor_at = $2 WHERE id = $3`,
          [orig.started_at, orig.cycle_anchor_at, bId('programs')])
      }
    })

    // Last: it deletes A.
    it('deleteAccount counts and unlinks only the caller\'s own rows', async () => {
      const before = await snapshotB()
      const res = await repo.deleteAccount(USER_A)
      expect(res.deleted).toBe(true)
      expect(res.anonymised.aiCallLog).toBe(0)
      expect(res.anonymised.errorEvents).toBe(0)
      expect(await snapshotB()).toBe(before)
    })
  })
})

/**
 * Column values the generic fixture cannot invent, or that a reader filters on. The fixture fills
 * only NOT NULL columns, so a reader gated on `steps > 0` or `completed_at IS NOT NULL` would see
 * nothing of B's whether or not it is scoped — every entry here was a survivor for that reason.
 */
const B_OVERRIDES: Record<string, Row> = {
  // The hash CHECK refuses the fixture's generic text, and the expiry CHECK wants a time after
  // created_at (now()). Live for a month, so the reader above has something to leak. A random hash:
  // other files seed this table in the same database, and the hash is UNIQUE.
  native_refresh_tokens: { token_hash: randomBytes(32).toString('hex'), expires_at: new Date(Date.now() + 30 * 86_400_000), device_label: 'B PHONE 2076' },
  apple_health_samples: {
    start_at: new Date('2026-09-15T00:00:00Z'), end_at: new Date('2026-09-15T00:01:00Z'),
    source_bundle_id: 'com.example', quantity_value: 1, quantity_unit: 'count',
  },
  body_metrics: {
    steps: 9000, weight_kg: 80, body_fat_pct: 20, bmr_kcal: 1800,
    source_map: JSON.stringify({ weight_kg: 'scale_ble', steps: 'manual' }),
  },
  sleep_sessions: { duration_hours: 7 },
  scale_raw_samples: { status: 'pending', decoded: '{}' },
  workout_sessions: { completed_at: new Date(AT.getTime() + 3_600_000) },
  exercise_logs: { estimated_1rm: 100, volume: 1000, muscle_groups: ['chest'], exercise_deloaded: false },
  set_logs: { weight_kg: 100, reps: 5 },
  personal_records: { achieved_at: AT, estimated_1rm: 999 },
  dexa_scans: { pct_fat: 25 },
  oura_heartrate: { source: 'ble', bpm: 70 },
  oura_ble_battery_poll: { measured_at: AT },
  oura_daily: { vo2_max: 45 },
  oura_daily_derived: { sleep_score: 80, readiness_score: 80, activity_score: 80 },
  oura_redecode_jobs: { started_at: AT },
  oura_raw_samples: { decoded: '{}' },
  oura_accel_chunks: { created_at: AT },
  workout_hr_stats: { avg_bpm: 120 },
  set_hr_stats: { logged_at: AT },
  supplement_logs: { amount: 5, unit: 'mg', vial_strength_mg: 10 },
  supplements: { stopped_on: '2026-09-15' },
  meal_plans: { is_active: true, generated_at: AT },
  running_plans: { is_active: true },
  // B's session (started AT) must count as inside the phase, or there is no count to get wrong.
  // baseline_complete: recordBaselineAnchors returns an already-complete row as-is, so read unscoped
  // it would hand B's periodization back to A.
  session_periodization: { phase_started_at: new Date(AT.getTime() - 86_400_000), baseline_complete: true },
  daily_zone_minutes: { zone1_sec: 600, zone2_sec: 600, max_hr: 190, resting_hr: 50 },
  // A text column holding a date, so the fixture's generic text would never match a day filter.
  oura_daytime_stress_buckets: { day: '2026-09-15', bucket_mid: AT },
  // A window the test instant (12:00 Brisbane) is outside of, so reading it would move the instant.
  meal_types: { time_start_hour: 20, time_end_hour: 22 },
}
