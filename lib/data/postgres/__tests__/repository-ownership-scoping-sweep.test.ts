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
  let db: import('@/lib/data/postgres/client').Db
  let g: SchemaGraph
  let b: SeededUser
  let owned: string[]
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
    for (const t of userTables) {
      cols.push(`(SELECT count(*)::int FROM public."${t}" WHERE user_id = $1) AS "#${t}"`)
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

    b = await seedEveryUserTable(pool, g, USER_B, { at: AT, overrides: B_OVERRIDES })
    createdCatalogue.push(...b.createdCatalogue)

    // Second rows the one-row-per-table fixture cannot express.
    await pool.query(
      `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, decoded, status)
       VALUES ($1, $2, 'b-dismissed-2425-raw', '{}', 'dismissed')`, [USER_B, AT])
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
    ['listBloodPanels', r => r.listBloodPanels(USER_A)],
    ['isRestDayChosen', r => r.isRestDayChosen(USER_A, D)],
    ['listRestDays', r => r.listRestDays(USER_A, FROM, TO)],
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
    ['getOuraClockOffsets', r => r.getOuraClockOffsets(USER_A), v => expect(leaked(v)).toEqual([])],
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
    ['mealPlanNeedsReview', r => r.mealPlanNeedsReview(USER_A, 3650)],
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
    ['completeWorkoutSession', r => r.completeWorkoutSession(bId('workout_sessions'), USER_A, AT)],
    ['setSessionRpe', r => r.setSessionRpe(USER_A, bId('workout_sessions'), 9)],
    ['setWorkoutSessionWarmupEnd', r => r.setWorkoutSessionWarmupEnd(USER_A, bId('workout_sessions'), AT)],
    ['confirmScaleSample', r => r.confirmScaleSample(USER_A, bNum('scale_raw_samples'))],
    ['dismissScaleSample', r => r.dismissScaleSample(USER_A, bNum('scale_raw_samples'))],
    ['setSleepVerdictResponse', r => r.setSleepVerdictResponse(USER_A, D, 'acknowledged')],
    ['setReadinessVerdictResponse', r => r.setReadinessVerdictResponse(USER_A, D, 'rated')],
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
    ['nullHistoricalDecoded', r => r.nullHistoricalDecoded(USER_A)],
    ['packOuraRawBuckets', r => r.packOuraRawBuckets(USER_A)],
    ['persistBodyCompFromMetrics', r => r.persistBodyCompFromMetrics(USER_A)],
    ['replaceOuraDailySummary', r => r.replaceOuraDailySummary(USER_A, [])],
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
    ['upsertPersonalRecordIfBetter compares only against the caller\'s own PR', r => r.upsertPersonalRecordIfBetter(USER_A, bVal('personal_records', 'exercise_name'), 500),
      v => { expect(v).toBe(true) }],
    ['applyLbsToKgFix does not read another user\'s PR', r => r.applyLbsToKgFix(USER_A, [bVal('personal_records', 'exercise_name')], TO),
      // A holds its own 500 by now (row above); B's is 999.
      v => { expect((v as { exercises: { oldPersonalRecord?: number | null }[] }).exercises[0]?.oldPersonalRecord ?? null).not.toBe(999) },
      { echoes: true }],
    // ---- periodization writes keyed by a client-supplied program-session id ----
    ['storePrescription', r => r.storePrescription(USER_A, bId('program_sessions'), { phase: 'deload' } as never, AT)],
    ['updatePrescriptionExercisesCache', r => r.updatePrescriptionExercisesCache(USER_A, bId('program_sessions'), { phase: 'deload' } as never)],
    // ---- maintenance sweeps scoped to the caller ----
    ['dropZoneMinutesFrom', r => r.dropZoneMinutesFrom(USER_A, FROM)],
    ['insertOuraAccelChunk (its retention prune)', async r => {
      const v = await r.insertOuraAccelChunk(USER_A, { startedAt: AT, sampleRate: 1, magnitudes: [1], steps: 0 })
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
      const p = probe as unknown as Record<string, unknown>
      expect({ accel: p.accelSamples ?? p.accel_samples ?? 0, hr: p.hrSamples ?? p.hr_samples ?? 0 }).toEqual({ accel: 0, hr: 0 })
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
  session_periodization: { phase_started_at: new Date(AT.getTime() - 86_400_000) },
  daily_zone_minutes: { zone1_sec: 600, zone2_sec: 600, max_hr: 190, resting_hr: 50 },
}
