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

describe.skipIf(!canRun)('repository ownership scoping — sweep survivors (#2425)', () => {
  let pool: import('pg').Pool
  let repo: Repo
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

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
        [id, `ownership-sweep-2425-${tag}@example.com`, TZ])
    }

    b = await seedEveryUserTable(pool, g, USER_B, { at: AT, overrides: B_OVERRIDES })
    createdCatalogue.push(...b.createdCatalogue)
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
    ['getSetHrStatsForExercise', r => r.getSetHrStatsForExercise(USER_A, { exerciseName: bVal('exercise_logs', 'exercise_name'), since: FROM_TS })],
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
  type Writer = [name: string, call: (r: Repo) => Promise<unknown>, after?: (v: unknown) => Promise<void> | void]
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
  ]

  for (const [name, call, after] of WRITERS) {
    it(`${name} cannot touch another user's rows`, async () => {
      const before = await snapshotB()
      // A rejection is a fine answer (and its message may name the id A sent); a resolved value
      // must not carry anything of B's.
      const v = await call(repo).catch(() => undefined)
      expect(leaked(v)).toEqual([])
      expect(await snapshotB()).toBe(before)
      if (after) await after(v)
    })
  }
})

/** Column values the generic fixture cannot invent, or that a reader filters on. */
const B_OVERRIDES: Record<string, Row> = {
  apple_health_samples: {
    start_at: new Date('2026-09-15T00:00:00Z'), end_at: new Date('2026-09-15T00:01:00Z'),
    source_bundle_id: 'com.example', quantity_value: 1, quantity_unit: 'count',
  },
}
