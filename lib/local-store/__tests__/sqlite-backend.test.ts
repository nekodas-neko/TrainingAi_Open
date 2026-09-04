import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runSQL, querySQL, beginTransaction, commitTransaction, rollbackTransaction } = vi.hoisted(() => ({
  runSQL:             vi.fn().mockResolvedValue(undefined),
  querySQL:           vi.fn().mockResolvedValue([]),
  beginTransaction:   vi.fn().mockResolvedValue(undefined),
  commitTransaction:  vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/sqlite/sqlite-service', () => ({ runSQL, querySQL, beginTransaction, commitTransaction, rollbackTransaction }))

import { SQLiteLocalStore } from '../sqlite-backend'

const store = new SQLiteLocalStore()

const workoutSession = {
  id: 'ws-1', sessionName: 'Session A', startedAt: '2026-07-01T08:00:00.000Z',
  completedAt: null, updatedAt: '2026-07-01T09:00:00.000Z', deletedAt: null,
  syncStatus: 'synced' as const,
}
const activityLog = {
  id: 'al-1', date: '2026-07-01', activityType: 'run', title: 'Morning run',
  durationMin: 30, distanceKm: 5, steps: null, avgHr: 150, maxHr: 170,
  caloriesBurned: 320, startTime: '07:15', endTime: null, notes: null,
  routePolyline: null, splits: null, bestEfforts: null, paceSeries: null,
  avgPaceSecPerKm: null, elevationGainM: null, elevationLossM: null,
  updatedAt: '2026-07-01T09:00:00.000Z', deletedAt: null,
  syncStatus: 'synced' as const,
}

const sleepSession = {
  id: 'ss-1', date: '2026-07-01', durationHours: 7.5, deepSleepHours: 1.2,
  remSleepHours: 1.8, lightSleepHours: 4.5, ouraId: 'oura-abc', efficiency: 91,
  onsetLatencySec: 600, averageHrvMs: 62, avgHeartRate: 54, lowestHeartRate: 48,
  restlessPeriods: 12, sleepScore: 84, respiratoryRate: 14.2, sleepPhase5Min: '1,2,3',
  timeInBedHours: 8.1, manualSleepStart: '2026-06-30T13:00:00.000Z',
  syncStatus: 'synced' as const, updatedAt: '2026-07-01T09:00:00.000Z',
}
const ouraDailyRow = {
  day: '2026-07-01', readinessScore: 80, sleepScore: 84, activityScore: 77,
  temperatureDeviation: 0.1, activeCalories: 450, contributors: { hrv_balance: 90 },
  syncStatus: 'synced' as const, updatedAt: '2026-07-01T09:00:00.000Z',
}
const ouraSummaryRow = {
  day: '2026-07-01', sleepDurationHours: 7.5, sleepEfficiency: 91, deepSleepHours: 1.2,
  remSleepHours: 1.8, restlessPeriods: 12, sleepLatencySec: 600, hrvAvgMs: 62, rhrLowBpm: 48,
  rhrAvgBpm: 54, recoveryIndexHours: 6, tempMeanC: 36.5, tempDevC: 0.1, metAvg: 1.3,
  breathAvgRpm: 14.2, hrvBaselineMeanX8: 500, hrvBaselineDevX8: 40, rhrBaselineMeanX8: 400,
  rhrBaselineDevX8: 30, tempBaselineMeanX8: 100, tempBaselineDevX8: 5, sleepBaselineMeanX8: 60,
  sleepBaselineDevX8: 8, metBaselineMeanX8: 10, metBaselineDevX8: 2, breathBaselineMeanX8: 112,
  breathBaselineDevX8: 6, nHistory: 30, syncStatus: 'synced' as const, updatedAt: '2026-07-01T09:00:00.000Z',
}
const ouraDerivedRow = {
  day: '2026-07-01', source: 'ble', modelVersions: { sleepnet: 'v1' }, sleepScore: 84,
  sleepContributors: { deep: 90 }, readinessScore: 80, readinessContributors: { hrv: 88 },
  readinessSource: 'derived', activityScore: 77, activityContributors: { move: 70 },
  activeCaloriesEst: 450, trainingLoadOts: 1.2, trainingLoadGate: 'ok', trainingLoadHigh: true, recoveryIndexHours: 6,
  wornHoursBle: 22, nightHrvBaselineMs: 60, illnessFlag: 'none', illnessScore: 3,
  illnessBiomarkers: { temp: 0.1 }, daytimeStressScaled: 40, stressHighMinutes: 30,
  recoveryHighMinutes: 120, chronicStressScore: 25, chronicStressContributors: { load: 20 },
  resilienceLevel: 3, resilienceDailyStress: 40, resilienceDailyRestorativeTime: 300,
  resilienceDailySleepRecovery: 80, resilienceGranular: 2.5, resilienceConfidence: 0.9,
  daytimeStressCoverageMin: 240, chronicStressGranularNights: 27,
  bdiDerived: 1.1, vascularAge: 32, pwv: 6.5, bodyComp: { ffm: 65 },
  syncStatus: 'synced' as const, updatedAt: '2026-07-01T09:00:00.000Z',
}

const supplement = {
  id: 'sup-1', name: 'Creatine', dose: '5g', reminderEnabled: false, reminderTime: null,
  sortOrder: 0, active: true, updatedAt: '2026-07-01T09:00:00.000Z', deletedAt: null,
}

function sqlCalls(): string[] { return runSQL.mock.calls.map(c => String(c[0])) }

describe('applyDelta pull-clobber guards', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  it('workout_sessions upsert only overwrites synced rows', async () => {
    await store.applyDelta({ workoutSessions: [workoutSession] })
    const stmt = sqlCalls().find(s => s.includes('INTO workout_sessions'))!
    expect(stmt).toContain(`WHERE workout_sessions.sync_status='synced'`)
  })

  it('workout_sessions delete spares pending local rows', async () => {
    await store.applyDelta({ workoutSessions: [{ ...workoutSession, deletedAt: '2026-07-01T10:00:00.000Z' }] })
    const stmt = sqlCalls().find(s => s.includes('DELETE FROM workout_sessions'))!
    expect(stmt).toContain(`sync_status='synced'`)
  })

  it('food_logs pull carries meal_type_id, date and logged_at, not just the quantity (Q-325)', async () => {
    // The conflict arm used to set only quantity_multiplier, updated_at and deleted_at, so a
    // server-side change to any other column never reached a device that already held the row.
    // Found while shipping Q-413 — the migration that corrects `logged_at` would have stopped at
    // the server — and it is also the column Q-412's reassign moves.
    await store.applyDelta({ foodLogs: [{
      id: 'fl-1', date: '2026-08-17', mealTypeId: 'mt-lunch', foodItemId: 'fi-1',
      quantityMultiplier: 1, loggedAt: '2026-08-17T03:30:00.000Z',
      updatedAt: '2026-08-19T09:00:00.000Z', deletedAt: null, syncStatus: 'synced' as const,
    }] })
    const stmt = sqlCalls().find(s => s.includes('INTO food_logs'))!
    const onConflict = stmt.slice(stmt.indexOf('ON CONFLICT'))
    for (const col of ['meal_type_id=excluded', 'date=excluded', 'logged_at=excluded', 'food_item_id=excluded']) {
      expect(onConflict, `the update arm must carry ${col}`).toContain(col)
    }
    // The guard is what protects a pending local edit — widening the SET must not remove it.
    expect(onConflict).toContain(`WHERE food_logs.sync_status='synced'`)
  })

  it('workout_sessions pull carries session_id / intensity_mode / was_override (Q-131)', async () => {
    // All three exist on both ends' schemas and were dropped by the pull mapping and this insert,
    // so a device restored from sync replayed its outbox with no program-session link and fell
    // back to matching the session by name.
    await store.applyDelta({ workoutSessions: [{
      ...workoutSession, sessionId: 'ps-9', intensityMode: 'deload', wasOverride: true,
    }] })
    const stmt = sqlCalls().find(s => s.includes('INTO workout_sessions'))!
    expect(stmt).toContain('session_id')
    expect(stmt).toContain('intensity_mode')
    expect(stmt).toContain('was_override')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO workout_sessions'))![1] as unknown[]
    expect(params).toContain('ps-9')
    expect(params).toContain('deload')
  })

  it('exercise_logs pull carries exercise_deloaded (Q-131)', async () => {
    await store.applyDelta({ exerciseLogs: [{
      id: 'el-1', workoutSessionId: 'ws-1', exerciseName: 'Bench', styleId: null, styleName: null,
      estimated1rm: null, target80: null, volume: 100, avgReps: 8, timeToComplete: null,
      muscleGroups: ['chest'], loggedAt: '2026-07-01T08:30:00.000Z', interExerciseRestSec: null,
      updatedAt: '2026-07-01T09:00:00.000Z', deletedAt: null, syncStatus: 'synced' as const,
      exerciseDeloaded: true,
    }] })
    const stmt = sqlCalls().find(s => s.includes('INTO exercise_logs'))!
    expect(stmt).toContain('exercise_deloaded')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO exercise_logs'))![1] as unknown[]
    expect(params).toContain(1)
  })

  it('supplements upsert only overwrites synced rows (Q-124)', async () => {
    // The one applyDelta arm that had no guard, because the local table had no sync_status
    // column at all — a rename made offline reverted to the server's old value on the next pull.
    await store.applyDelta({ supplements: [supplement] })
    const stmt = sqlCalls().find(s => s.includes('INTO supplements'))!
    expect(stmt).toContain(`WHERE supplements.sync_status='synced'`)
  })

  it('supplements delete tombstone spares pending local rows (Q-124)', async () => {
    await store.applyDelta({ supplements: [{ ...supplement, deletedAt: '2026-07-01T10:00:00.000Z' }] })
    const stmt = sqlCalls().find(s => s.includes('DELETE FROM supplements'))!
    expect(stmt).toContain(`sync_status='synced'`)
    expect(sqlCalls().some(s => s.includes('INTO supplements'))).toBe(false)
  })

  it('a local supplement write marks the row pending so the next pull cannot clobber it', async () => {
    await store.upsertSupplement(supplement)
    const stmt = sqlCalls().find(s => s.includes('INTO supplements'))!
    expect(stmt).toContain(`'pending'`)
    expect(stmt).toContain(`sync_status='pending'`)
  })

  it('activity_logs upsert carries calories_burned/start_time and guards pending rows', async () => {
    await store.applyDelta({ activityLogs: [activityLog] })
    const stmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expect(stmt).toContain('calories_burned')
    expect(stmt).toContain('start_time')
    expect(stmt).toContain(`WHERE activity_logs.sync_status='synced'`)
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(params).toContain(320)
    expect(params).toContain('07:15')
  })

  it('activity_logs delete tombstone removes the local row, guarded to synced rows', async () => {
    await store.applyDelta({ activityLogs: [{ ...activityLog, deletedAt: '2026-07-01T10:00:00.000Z' }] })
    const stmt = sqlCalls().find(s => s.includes('DELETE FROM activity_logs'))!
    expect(stmt).toContain(`sync_status='synced'`)
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('DELETE FROM activity_logs'))![1] as unknown[]
    expect(params).toEqual(['al-1'])
    // a tombstone must never also run the upsert for the same row
    expect(sqlCalls().some(s => s.includes('INTO activity_logs'))).toBe(false)
  })

  it('activity_logs upsert (applyDelta) carries GPS route/pace/elevation fields', async () => {
    await store.applyDelta({ activityLogs: [{
      ...activityLog,
      routePolyline: 'enc123', splits: [{ km: 1, paceSec: 300 }],
      bestEfforts: { '1k': 290 }, paceSeries: [{ tSec: 0, paceSec: 300 }],
      avgPaceSecPerKm: 300, elevationGainM: 50, elevationLossM: 45,
      endTime: '07:45', notes: 'felt good',
    }] })
    const stmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expect(stmt).toContain('route_polyline')
    expect(stmt).toContain('splits')
    expect(stmt).toContain('best_efforts')
    expect(stmt).toContain('pace_series')
    expect(stmt).toContain('avg_pace_sec_per_km')
    expect(stmt).toContain('elevation_gain_m')
    expect(stmt).toContain('elevation_loss_m')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(params).toContain('enc123')
    expect(params).toContain(JSON.stringify([{ km: 1, paceSec: 300 }]))
    expect(params).toContain(JSON.stringify({ '1k': 290 }))
    expect(params).toContain('felt good')
  })

  it('activity_logs carries cadence through BOTH write paths', async () => {
    // Two separate INSERT statements write this table (applyDelta's pull upsert and
    // upsertActivityLog's local write). A column added to only one fails silently as
    // "the save didn't persist", so both are asserted here.
    const withCadence = {
      ...activityLog,
      cadenceSpm: 168.4,
      cadenceSeries: [{ tSec: 0, spm: 166 }, { tSec: 10, spm: 170 }],
      cadenceSource: 'strap' as const,
    }
    const expectColumns = (stmt: string) => {
      expect(stmt).toContain('cadence_spm')
      expect(stmt).toContain('cadence_series')
      expect(stmt).toContain('cadence_source')
    }

    await store.applyDelta({ activityLogs: [withCadence] })
    const pullStmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expectColumns(pullStmt)
    const pullParams = runSQL.mock.calls
      .find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(pullParams).toContain(168.4)
    expect(pullParams).toContain('strap')
    expect(pullParams).toContain(JSON.stringify(withCadence.cadenceSeries))

    runSQL.mockClear()
    await store.upsertActivityLog(withCadence)
    const localStmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expectColumns(localStmt)
    const localParams = runSQL.mock.calls
      .find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(localParams).toContain(168.4)
    expect(localParams).toContain('strap')
    expect(localParams).toContain(JSON.stringify(withCadence.cadenceSeries))
  })

  it('sleep_sessions upsert carries the Oura columns and clobber-guards pending rows (R6)', async () => {
    await store.applyDelta({ sleepSessions: [sleepSession] })
    const stmt = sqlCalls().find(s => s.includes('INTO sleep_sessions'))!
    // The Oura columns restore isn't allowed to strip.
    for (const col of ['oura_id', 'efficiency', 'average_hrv_ms', 'lowest_heart_rate',
      'restless_periods', 'sleep_score', 'respiratory_rate', 'sleep_phase_5_min', 'time_in_bed_hours']) {
      expect(stmt).toContain(col)
    }
    expect(stmt).toContain(`WHERE sleep_sessions.sync_status='synced'`)
    expect(stmt).toContain('excluded.updated_at > sleep_sessions.updated_at')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO sleep_sessions'))![1] as unknown[]
    expect(params).toContain('oura-abc')  // ouraId
    expect(params).toContain(62)          // averageHrvMs
    expect(params).toContain('1,2,3')     // sleepPhase5Min stage codes
  })

  // Q-519. A column present in the delta and absent from this statement is the exact sync-drift
  // shape the standing rule names: server payload, delta output and applyDelta columns must be one
  // set, and a mismatch shows up as data that silently never reaches the device.
  it('sleep_sessions upsert carries the remembered bedtime (Q-519)', async () => {
    await store.applyDelta({ sleepSessions: [sleepSession] })
    const stmt = sqlCalls().find(s => s.includes('INTO sleep_sessions'))!
    expect(stmt).toContain('manual_sleep_start')
    expect(stmt).toContain('manual_sleep_start=excluded.manual_sleep_start')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO sleep_sessions'))![1] as unknown[]
    expect(params).toContain('2026-06-30T13:00:00.000Z')

    // Column count must equal the VALUES arity, or every value after the missing column lands one
    // slot to the left — silent, and worse than not writing it at all. Counting placeholders alone
    // does NOT catch this: dropping a column name while keeping its `?` leaves both counts matching
    // the params array and only the columns short. (Found by mutating exactly that.)
    const cols = stmt.slice(stmt.indexOf('(') + 1, stmt.indexOf('VALUES')).replace(/\)\s*$/, '')
      .split(',').map(c => c.trim()).filter(Boolean)
    const values = stmt.slice(stmt.indexOf('VALUES ('))
    const arity = values.slice(0, values.indexOf(')')).split(',').length
    expect(cols).toHaveLength(arity)
    expect((stmt.slice(0, stmt.indexOf('ON CONFLICT')).match(/\?/g) ?? []).length).toBe(params.length)
  })

  it('getSleepSessions reads the remembered bedtime back (Q-519)', async () => {
    querySQL.mockResolvedValueOnce([{
      id: 'ss-1', date: '2026-07-01', duration_hours: 7.5, deep_sleep_hours: 1.2,
      rem_sleep_hours: 1.8, light_sleep_hours: 4.5, oura_id: 'oura-abc', efficiency: 91,
      onset_latency_sec: 600, average_hrv_ms: 62, avg_heart_rate: 54, lowest_heart_rate: 48,
      restless_periods: 12, sleep_score: 84, respiratory_rate: 14.2, sleep_phase_5_min: '1,2,3',
      time_in_bed_hours: 8.1, manual_sleep_start: '2026-06-30T13:00:00.000Z',
      sync_status: 'synced', updated_at: '2026-07-01T09:00:00.000Z',
    }])
    const [row] = await store.getSleepSessions('2026-07-01')
    expect(row.manualSleepStart).toBe('2026-06-30T13:00:00.000Z')
    expect(row.durationHours).toBe(7.5)   // and nothing else moved
  })

  it('oura_daily upsert is clobber-guarded, not INSERT OR REPLACE (D4)', async () => {
    await store.applyDelta({ ouraDaily: [ouraDailyRow] })
    const stmt = sqlCalls().find(s => s.includes('INTO oura_daily') && !s.includes('summary') && !s.includes('derived'))!
    expect(stmt).not.toContain('INSERT OR REPLACE')
    expect(stmt).toContain('ON CONFLICT(day) DO UPDATE')
    expect(stmt).toContain(`WHERE oura_daily.sync_status='synced'`)
    expect(stmt).toContain('excluded.updated_at > oura_daily.updated_at')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO oura_daily') && !String(c[0]).includes('summary'))![1] as unknown[]
    expect(params).toContain(JSON.stringify({ hrv_balance: 90 })) // contributors stringified
  })

  it('oura_daily_summary upsert is clobber-guarded and carries baseline + physiology columns', async () => {
    await store.applyDelta({ ouraDailySummary: [ouraSummaryRow] })
    const stmt = sqlCalls().find(s => s.includes('INTO oura_daily_summary'))!
    for (const col of ['hrv_baseline_mean_x8', 'breath_baseline_dev_x8', 'breath_avg_rpm', 'n_history']) {
      expect(stmt).toContain(col)
    }
    expect(stmt).toContain(`WHERE oura_daily_summary.sync_status='synced'`)
    expect(stmt).toContain('excluded.updated_at > oura_daily_summary.updated_at')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO oura_daily_summary'))![1] as unknown[]
    expect(params).toContain(62)  // hrvAvgMs
    expect(params).toContain(30)  // nHistory (last EMA-state field)
    expect(params).toContain(112) // breathBaselineMeanX8 (a baseline column round-trips)
  })

  it('oura_daily_derived upsert clobber-guards, stringifies JSON columns, stores boolean 0/1', async () => {
    await store.applyDelta({ ouraDailyDerived: [ouraDerivedRow] })
    const stmt = sqlCalls().find(s => s.includes('INTO oura_daily_derived'))!
    for (const col of ['model_versions', 'readiness_contributors', 'illness_biomarkers',
      'chronic_stress_contributors', 'body_comp', 'resilience_granular', 'training_load_high']) {
      expect(stmt).toContain(col)
    }
    expect(stmt).toContain(`WHERE oura_daily_derived.sync_status='synced'`)
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO oura_daily_derived'))![1] as unknown[]
    expect(params).toContain(JSON.stringify({ sleepnet: 'v1' })) // modelVersions stringified
    expect(params).toContain(JSON.stringify({ ffm: 65 }))        // bodyComp stringified
    expect(params).toContain(1)     // trainingLoadHigh true → 1
    expect(params).not.toContain(true) // never bind a raw boolean
    expect(params).toContain(2.5)   // resilienceGranular stays a REAL (not stringified)
  })
})

const bodyMetric = {
  date: '2026-07-01', weightKg: 82.5, bodyFatPct: null, steps: 9000, calories: null,
  proteinG: null, carbsG: null, fatG: null, waterMl: 1500, restingHeartRate: null,
  hrvMs: null, spo2Pct: null, distanceKm: null, updatedAt: '2026-07-01T09:00:00.000Z',
  deletedAt: null, syncStatus: 'synced' as const,
}
const personalRecord = {
  exerciseName: 'Bench Press', exerciseId: null, estimated1rm: 100,
  achievedAt: '2026-07-01T09:00:00.000Z', updatedAt: '2026-07-01T09:00:00.000Z',
  syncStatus: 'synced' as const,
}

describe('applyDelta timestamp-gated last-write-wins', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  it('body_metrics only overwrite older synced rows', async () => {
    await store.applyDelta({ bodyMetrics: [bodyMetric] })
    const stmt = sqlCalls().find(s => s.includes('INTO body_metrics'))!
    expect(stmt).toContain(`WHERE body_metrics.sync_status='synced'`)
    expect(stmt).toContain('excluded.updated_at > body_metrics.updated_at')
  })

  it('personal_records take the server value verbatim (no MAX clamp)', async () => {
    await store.applyDelta({ personalRecords: [personalRecord] })
    const stmt = sqlCalls().find(s => s.includes('INTO personal_records'))!
    expect(stmt).not.toContain('MAX(')
    expect(stmt).toContain('estimated_1rm=excluded.estimated_1rm')
  })
})

describe('applyDelta batching', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  // Regression for a real on-device bug (2026-07-23): literal 'BEGIN'/'COMMIT' SQL text
  // through runSQL defaults the plugin's per-call transaction=true, so each individual
  // write auto-commits itself and the final literal COMMIT then fails with
  // "no current transaction". The fix uses the plugin's real beginTransaction/
  // commitTransaction/rollbackTransaction API instead, tracked in sqlite-service's
  // _inTransaction flag so every runSQL write in between passes transaction=false.
  it('wraps writes in the real begin/commit transaction API, never literal BEGIN/COMMIT SQL text', async () => {
    await store.applyDelta({ workoutSessions: [workoutSession], activityLogs: [activityLog] })
    expect(beginTransaction).toHaveBeenCalledTimes(1)
    expect(commitTransaction).toHaveBeenCalledTimes(1)
    expect(rollbackTransaction).not.toHaveBeenCalled()
    expect(sqlCalls().some(s => /^(BEGIN|COMMIT|ROLLBACK)$/.test(s))).toBe(false)
    // begin happens before any write; commit happens after all of them.
    const writeOrders = runSQL.mock.invocationCallOrder
    expect(beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...writeOrders))
    expect(commitTransaction.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...writeOrders))
  })

  it('rolls back via the real transaction API when a write fails', async () => {
    runSQL.mockImplementation(async (sql) => {
      if (String(sql).includes('INTO workout_sessions')) throw new Error('disk I/O')
    })
    await expect(store.applyDelta({ workoutSessions: [workoutSession] })).rejects.toThrow('disk I/O')
    expect(rollbackTransaction).toHaveBeenCalledTimes(1)
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('needs no SELECT sync_status pre-reads (guards folded into upserts)', async () => {
    const foodLog = { id: 'fl-1', date: '2026-07-01', mealTypeId: 'mt-1', foodItemId: 'fi-1',
      quantityMultiplier: 1, loggedAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z', deletedAt: null, syncStatus: 'synced' as const }
    await store.applyDelta({ foodLogs: [foodLog] })
    const selects = querySQL.mock.calls.map(c => String(c[0])).filter(s => s.includes('sync_status'))
    expect(selects).toEqual([])
    const stmt = sqlCalls().find(s => s.includes('INTO food_logs'))!
    expect(stmt).toContain(`WHERE food_logs.sync_status='synced'`)
  })
})

describe('upsertBodyMetric read-merge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('preserves unspecified fields from the existing local row instead of nulling them', async () => {
    querySQL.mockResolvedValueOnce([{
      date: '2026-07-01', weight_kg: null, body_fat_pct: null, steps: 9000, calories: 2000,
      protein_g: 150, carbs_g: 200, fat_g: 60, water_ml: 1500, resting_heart_rate: 55,
      hrv_ms: 45, spo2_pct: 97, distance_km: 5, updated_at: '2026-07-01T08:00:00.000Z',
      deleted_at: null, sync_status: 'synced',
    }])
    await store.upsertBodyMetric({
      date: '2026-07-01', weightKg: 82.5, bodyFatPct: null, steps: null, calories: null,
      proteinG: null, carbsG: null, fatG: null, waterMl: null, restingHeartRate: null,
      hrvMs: null, spo2Pct: null, distanceKm: null,
      updatedAt: '2026-07-01T20:00:00.000Z', deletedAt: null, syncStatus: 'pending',
    })
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO body_metrics'))![1] as unknown[]
    // date, weight_kg, body_fat_pct, steps, calories, protein_g, carbs_g, fat_g,
    // water_ml, resting_heart_rate, hrv_ms, spo2_pct, distance_km, updated_at, deleted_at, sync_status
    expect(params[1]).toBe(82.5)  // the field this write actually targets
    expect(params[3]).toBe(9000)  // steps preserved from the existing row
    expect(params[4]).toBe(2000)  // calories preserved
    expect(params[8]).toBe(1500)  // waterMl preserved
    expect(params[12]).toBe(5)    // distanceKm preserved
  })

  it('has no existing row: unspecified fields stay null (first log of the day)', async () => {
    querySQL.mockResolvedValueOnce([])
    await store.upsertBodyMetric({
      date: '2026-07-02', weightKg: 80, bodyFatPct: null, steps: null, calories: null,
      proteinG: null, carbsG: null, fatG: null, waterMl: null, restingHeartRate: null,
      hrvMs: null, spo2Pct: null, distanceKm: null,
      updatedAt: '2026-07-02T08:00:00.000Z', deletedAt: null, syncStatus: 'pending',
    })
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO body_metrics'))![1] as unknown[]
    expect(params[1]).toBe(80)
    expect(params[3]).toBeNull()
  })
})

describe('upsertActivityLog GPS fields', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('persists route/pace/elevation data on the local write path', async () => {
    await store.upsertActivityLog({
      id: 'al-2', date: '2026-07-01', activityType: 'run', title: 'Trail run',
      durationMin: 45, distanceKm: 8, steps: null, avgHr: 150, maxHr: 175,
      caloriesBurned: null, startTime: '07:00', endTime: '07:45', notes: 'felt good',
      routePolyline: 'enc123', splits: [{ km: 1, paceSec: 300 }],
      bestEfforts: { '1k': 290 }, paceSeries: [{ tSec: 0, paceSec: 300 }],
      avgPaceSecPerKm: 300, elevationGainM: 50, elevationLossM: 45,
      updatedAt: '2026-07-01T08:00:00.000Z', syncStatus: 'pending',
    })
    const stmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expect(stmt).toContain('route_polyline')
    expect(stmt).toContain('splits')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(params).toContain('enc123')
    expect(params).toContain(JSON.stringify([{ km: 1, paceSec: 300 }]))
    expect(params).toContain(JSON.stringify({ '1k': 290 }))
  })
})

// SYN-4: these mirrors run only after an awaited web PATCH/DELETE already succeeded
// (local == server at that instant) — must write 'synced', never 'pending', or the
// row is permanently stranded behind every future pull's `WHERE sync_status='synced'` gate.
describe('deleteExerciseLogLocally / updateExerciseLogLocally sync_status (SYN-4)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deleteExerciseLogLocally marks both the exercise_log and its sets synced, not pending', async () => {
    await store.deleteExerciseLogLocally('el-1')
    const exStmt = sqlCalls().find(s => s.includes('UPDATE exercise_logs'))!
    expect(exStmt).toContain(`sync_status='synced'`)
    expect(exStmt).not.toContain(`sync_status='pending'`)
    const setStmt = sqlCalls().find(s => s.includes('UPDATE set_logs'))!
    expect(setStmt).toContain(`sync_status='synced'`)
  })

  // Q-328. `deleteActivityLog`, which wrote `sync_status='synced'` here, is gone with the last
  // bare-`fetch` caller — the delete goes through the outbox now, so the row must be 'pending'
  // until its push is confirmed or a pull would clobber it. Both values remain correct at their own
  // moment, which is why `markActivityLogSynced` below exists; what changed is which one the
  // CLIENT writes. That is the whole risk in this pair, so it is asserted both ways.
  it('softDeleteActivityLogPending marks it pending, so a queued delete is not pull-clobbered', async () => {
    await store.softDeleteActivityLogPending('al-1')
    const stmt = sqlCalls().find(s => s.includes('UPDATE activity_logs'))!
    expect(stmt).toContain('deleted_at=?')
    expect(stmt).toContain(`sync_status='pending'`)
    expect(stmt).not.toContain(`sync_status='synced'`)
  })

  it('softDeleteActivityLogPending scopes to the one id and stamps both timestamps together', async () => {
    await store.softDeleteActivityLogPending('al-1')
    const call = runSQL.mock.calls.find(c => String(c[0]).includes('UPDATE activity_logs'))!
    expect(String(call[0])).toContain('WHERE id=?')
    const params = call[1] as unknown[]
    expect(params[2]).toBe('al-1')
    expect(params[0]).toBe(params[1])
  })

  // The other half: without this the pending tombstone above is stuck forever, because the reaper
  // only removes rows already marked synced.
  it('markActivityLogSynced flips the row without touching deleted_at', async () => {
    await store.markActivityLogSynced('al-1')
    const stmt = sqlCalls().find(s => s.includes('UPDATE activity_logs'))!
    expect(stmt).toContain(`sync_status='synced'`)
    expect(stmt).not.toContain('deleted_at')
  })

  // Q-488 recorded that the first thing a session reaches for is a read-merge `upsertActivityLog`
  // with `deletedAt: now`. It compiles, type-checks, passes lint — and changes nothing, because that
  // method's INSERT column list and its ON CONFLICT DO UPDATE both omit deleted_at. This pins the
  // trap: if someone adds deleted_at to the upsert, this test fails and points at the soft-delete.
  it('upsertActivityLog does NOT touch deleted_at — a "soft delete via upsert" is a silent no-op', async () => {
    await store.upsertActivityLog(activityLog)
    const stmt = sqlCalls().find(s => s.includes('INSERT INTO activity_logs'))!
    expect(stmt).not.toContain('deleted_at')
  })

  it('updateExerciseLogLocally marks the exercise_log and each set synced, not pending', async () => {
    await store.updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 100, reps: 5, intensityPct: 80 },
    ])
    const exStmt = sqlCalls().find(s => s.startsWith('UPDATE exercise_logs'))!
    expect(exStmt).toContain(`sync_status='synced'`)
    const setStmt = sqlCalls().find(s => s.includes('weight_kg=?') && s.includes('intensity_pct=?'))!
    expect(setStmt).toContain(`sync_status='synced'`)
  })

  it('updateExerciseLogLocally preserves the server-recomputed intensityPct when omitted', async () => {
    await store.updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 100, reps: 5 },
    ])
    const setStmt = sqlCalls().find(s => s.includes('UPDATE set_logs') && s.includes('weight_kg=?'))!
    expect(setStmt).not.toContain('intensity_pct')
  })

  it('updateExerciseLogLocally tombstones tail sets beyond the new set count, mirroring the server truncation', async () => {
    await store.updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 100, reps: 5, intensityPct: 80 },
      { setNumber: 2, weightKg: 100, reps: 5, intensityPct: 80 },
    ])
    const truncStmt = sqlCalls().find(s => s.includes('set_number>?') && s.includes('deleted_at'))!
    expect(truncStmt).toBeTruthy()
    const params = runSQL.mock.calls.find(c => String(c[0]) === truncStmt)![1] as unknown[]
    expect(params).toContain(2) // maxSetNumber
    expect(params).toContain('el-1')
  })
})

// SYN-1/SYN-2: whole-session delete mirror — same 'synced' reasoning as above.
describe('deleteWorkoutSessionLocally (SYN-1/SYN-2)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('tombstones the session and every child exercise_log/set_log as synced', async () => {
    await store.deleteWorkoutSessionLocally('ws-1')
    const wsStmt = sqlCalls().find(s => s.includes('UPDATE workout_sessions'))!
    expect(wsStmt).toContain(`sync_status='synced'`)
    const elStmt = sqlCalls().find(s => s.includes('UPDATE exercise_logs') && s.includes('workout_session_id'))!
    expect(elStmt).toContain(`sync_status='synced'`)
    const slStmt = sqlCalls().find(s => s.includes('UPDATE set_logs') && s.includes('exercise_log_id IN'))!
    expect(slStmt).toContain(`sync_status='synced'`)
  })
})

describe('markSessionSynced skips the flip while a sibling mutation is still queued (SYN-7)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('flips to synced when no other mutation references the session', async () => {
    querySQL.mockResolvedValueOnce([{ cnt: 0 }])
    await store.markSessionSynced('ws-1')
    const updateStmt = sqlCalls().find(s => s.includes('UPDATE workout_sessions') && s.includes('sync_status'))
    expect(updateStmt).toBeTruthy()
  })

  it('skips the flip when a sibling workout_log/session_rpe/complete_workout mutation is still queued', async () => {
    querySQL.mockResolvedValueOnce([{ cnt: 1 }])
    await store.markSessionSynced('ws-1')
    const updateStmt = sqlCalls().find(s => s.includes('UPDATE workout_sessions') && s.includes('sync_status'))
    expect(updateStmt).toBeUndefined()
  })
})

describe('D2 prep — Oura local read/write accessors (Phase-1 Task 1)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('upsertOuraDailySummary writes the full row, sync_status as given (no clobber-guard)', async () => {
    await store.upsertOuraDailySummary(ouraSummaryRow)
    const stmt = sqlCalls().find(s => s.includes('INTO oura_daily_summary'))!
    expect(stmt).not.toContain('WHERE')
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO oura_daily_summary'))![1] as unknown[]
    expect(params[0]).toBe('2026-07-01')
    expect(params[params.length - 1]).toBe('synced') // sync_status passed through as given
  })

  it('getOuraDailySummary round-trips a mocked row back to camelCase', async () => {
    querySQL.mockResolvedValueOnce([{
      day: '2026-07-01', sleep_duration_hours: 7.5, sleep_efficiency: 91, deep_sleep_hours: 1.2,
      rem_sleep_hours: 1.8, restless_periods: 12, sleep_latency_sec: 600, hrv_avg_ms: 62,
      rhr_low_bpm: 48, rhr_avg_bpm: 54, recovery_index_hours: 6, temp_mean_c: 36.5, temp_dev_c: 0.1,
      met_avg: 1.3, breath_avg_rpm: 14.2, hrv_baseline_mean_x8: 500, hrv_baseline_dev_x8: 40,
      rhr_baseline_mean_x8: 400, rhr_baseline_dev_x8: 30, temp_baseline_mean_x8: 100,
      temp_baseline_dev_x8: 5, sleep_baseline_mean_x8: 60, sleep_baseline_dev_x8: 8,
      met_baseline_mean_x8: 10, met_baseline_dev_x8: 2, breath_baseline_mean_x8: 112,
      breath_baseline_dev_x8: 6, n_history: 30, sync_status: 'synced', updated_at: '2026-07-01T09:00:00.000Z',
    }])
    const [row] = await store.getOuraDailySummary('2026-07-01', '2026-07-01')
    expect(row).toEqual(ouraSummaryRow)
  })

  it('upsertOuraDailyDerived JSON-stringifies contributor/biomarker columns and 0/1-encodes the boolean', async () => {
    await store.upsertOuraDailyDerived(ouraDerivedRow)
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO oura_daily_derived'))![1] as unknown[]
    expect(params[2]).toBe(JSON.stringify({ sleepnet: 'v1' })) // model_versions
    // Positional, so it moves whenever a column is inserted before it — Q-270's `training_load_gate`
    // went in at 12 and pushed this to 13. The index is the point of the assertion (it proves the
    // value list still lines up with the column list), so it is corrected rather than made robust.
    expect(params[13]).toBe(1) // training_load_high: true -> 1
  })

  it('getOuraDailyDerived round-trips JSON columns and the boolean back correctly', async () => {
    querySQL.mockResolvedValueOnce([{
      day: '2026-07-01', source: 'ble', model_versions: JSON.stringify({ sleepnet: 'v1' }), sleep_score: 84,
      sleep_contributors: JSON.stringify({ deep: 90 }), readiness_score: 80,
      readiness_contributors: JSON.stringify({ hrv: 88 }), readiness_source: 'derived', activity_score: 77,
      activity_contributors: JSON.stringify({ move: 70 }), active_calories_est: 450, training_load_ots: 1.2,
      training_load_gate: 'ok',
      training_load_high: 1, recovery_index_hours: 6, worn_hours_ble: 22, night_hrv_baseline_ms: 60,
      illness_flag: 'none', illness_score: 3, illness_biomarkers: JSON.stringify({ temp: 0.1 }),
      daytime_stress_scaled: 40, stress_high_minutes: 30, recovery_high_minutes: 120, chronic_stress_score: 25,
      chronic_stress_contributors: JSON.stringify({ load: 20 }), resilience_level: 3, resilience_daily_stress: 40,
      resilience_daily_restorative_time: 300, resilience_daily_sleep_recovery: 80, resilience_granular: 2.5,
      resilience_confidence: 0.9, daytime_stress_coverage_min: 240, chronic_stress_granular_nights: 27, bdi_derived: 1.1, vascular_age: 32, pwv: 6.5,
      body_comp: JSON.stringify({ ffm: 65 }), sync_status: 'synced', updated_at: '2026-07-01T09:00:00.000Z',
    }])
    const [row] = await store.getOuraDailyDerived('2026-07-01', '2026-07-01')
    expect(row).toEqual(ouraDerivedRow)
  })

  it('upsertOuraBucket targets the (tier, bucket_start_ms) conflict key', async () => {
    await store.upsertOuraBucket({
      tier: 'coarse', bucketStartMs: 1_000_000, bucketStartDs: 10_000_000, localDate: '2026-07-01',
      hrMean: 60, hrMin: 50, hrMax: 90, hrvRmssdMs: 45, spo2Pct: 97, perfusionIndex: 1.2,
      skinTempC: 33.5, metMean: 1.3, metMinutes: 12, motionMad: 0.4, ibiMs: '[800,810]',
      sampleCount: 20, syncStatus: 'pending', updatedAt: '2026-07-01T09:00:00.000Z',
    })
    const stmt = sqlCalls().find(s => s.includes('INTO oura_bucket'))!
    expect(stmt).toContain('ON CONFLICT(tier, bucket_start_ms)')
  })

  it('getOuraBuckets filters by tier and the bucket_start_ms window', async () => {
    querySQL.mockResolvedValueOnce([])
    await store.getOuraBuckets('coarse', 0, 1_000_000)
    const call = querySQL.mock.calls.find(c => String(c[0]).includes('FROM oura_bucket'))!
    expect(call[1]).toEqual(['coarse', 0, 1_000_000])
  })

  it('upsertOuraHeartrate / getOuraHeartrate round-trip a point', async () => {
    await store.upsertOuraHeartrate({ tsMs: 1_000, bpm: 62, source: 'ble', syncStatus: 'synced', updatedAt: '2026-07-01T09:00:00.000Z' })
    const stmt = sqlCalls().find(s => s.includes('INTO oura_heartrate'))!
    expect(stmt).toContain('ON CONFLICT(ts_ms)')

    querySQL.mockResolvedValueOnce([{ ts_ms: 1000, bpm: 62, source: 'ble', sync_status: 'synced', updated_at: '2026-07-01T09:00:00.000Z' }])
    const [row] = await store.getOuraHeartrate(0, 2000)
    expect(row).toEqual({ tsMs: 1000, bpm: 62, source: 'ble', syncStatus: 'synced', updatedAt: '2026-07-01T09:00:00.000Z' })
  })

  // getWorkoutHistory was 1 + N + (N x M) queries: one for sessions, one per
  // session for its exercise logs, then one per exercise log for its sets. Twenty
  // sessions of five exercises is ~121 round trips across the Capacitor bridge,
  // paid on the home screen, Health, and the active workout screen. These lock in
  // the constant-query rewrite AND the grouping it has to preserve.
  describe('getWorkoutHistory', () => {
    const sessionRow = (id: string, startedAt: string) => ({
      id, session_name: 'S', started_at: startedAt, completed_at: null,
      updated_at: startedAt, deleted_at: null, sync_status: 'synced',
    })
    const elRow = (id: string, sessionId: string, name: string, loggedAt: string) => ({
      id, workout_session_id: sessionId, exercise_name: name, style_id: null,
      style_name: null, estimated_1rm: null, target_80: null, volume: null,
      avg_reps: null, time_to_complete: null, muscle_groups: null,
      logged_at: loggedAt, inter_exercise_rest_sec: null,
      updated_at: loggedAt, deleted_at: null, sync_status: 'synced',
      exercise_deloaded: 0,
    })
    const setRow = (id: string, logId: string, n: number) => ({
      id, exercise_log_id: logId, set_number: n, weight_kg: 100, reps: 5,
      set_time_sec: null, rest_time_sec: null, intensity_pct: null,
      use_for_1rm: 1, set_start_ms: null, set_end_ms: null, rpe: null,
      planned_pct: null, planned_reps: null, planned_rest_sec: null,
      updated_at: '2026-07-01T09:00:00.000Z', deleted_at: null, sync_status: 'synced',
    })

    it('issues a constant number of queries regardless of history size', async () => {
      querySQL.mockResolvedValueOnce([sessionRow('ws-1', '2026-07-01T08:00:00.000Z'),
                                      sessionRow('ws-2', '2026-07-02T08:00:00.000Z'),
                                      sessionRow('ws-3', '2026-07-03T08:00:00.000Z')])
      querySQL.mockResolvedValueOnce([elRow('el-1', 'ws-1', 'Squat', '2026-07-01T08:10:00.000Z'),
                                      elRow('el-2', 'ws-2', 'Bench', '2026-07-02T08:10:00.000Z'),
                                      elRow('el-3', 'ws-3', 'Row',   '2026-07-03T08:10:00.000Z')])
      querySQL.mockResolvedValueOnce([setRow('s-1', 'el-1', 1), setRow('s-2', 'el-2', 1)])

      await store.getWorkoutHistory('2026-06-01')

      // sessions + exercise logs + set logs, never per-row.
      expect(querySQL).toHaveBeenCalledTimes(3)
    })

    it('groups sets under their exercise log and logs under their session', async () => {
      querySQL.mockResolvedValueOnce([sessionRow('ws-1', '2026-07-01T08:00:00.000Z'),
                                      sessionRow('ws-2', '2026-07-02T08:00:00.000Z')])
      querySQL.mockResolvedValueOnce([elRow('el-1', 'ws-1', 'Squat', '2026-07-01T08:10:00.000Z'),
                                      elRow('el-2', 'ws-1', 'Bench', '2026-07-01T08:20:00.000Z'),
                                      elRow('el-3', 'ws-2', 'Row',   '2026-07-02T08:10:00.000Z')])
      querySQL.mockResolvedValueOnce([setRow('s-1', 'el-1', 1), setRow('s-2', 'el-1', 2),
                                      setRow('s-3', 'el-3', 1)])

      const history = await store.getWorkoutHistory('2026-06-01')

      expect(history.map(h => h.session.id)).toEqual(['ws-1', 'ws-2'])
      expect(history[0].exerciseLogs.map(e => e.exerciseName)).toEqual(['Squat', 'Bench'])
      expect(history[0].exerciseLogs[0].sets.map(s => s.id)).toEqual(['s-1', 's-2'])
      // Bench has no sets — must be an empty array, not undefined, and not
      // inherit another log's sets.
      expect(history[0].exerciseLogs[1].sets).toEqual([])
      expect(history[1].exerciseLogs.map(e => e.exerciseName)).toEqual(['Row'])
      expect(history[1].exerciseLogs[0].sets.map(s => s.id)).toEqual(['s-3'])
    })

    it('keeps a session with no exercise logs, with an empty array', async () => {
      querySQL.mockResolvedValueOnce([sessionRow('ws-1', '2026-07-01T08:00:00.000Z'),
                                      sessionRow('ws-2', '2026-07-02T08:00:00.000Z')])
      querySQL.mockResolvedValueOnce([elRow('el-1', 'ws-1', 'Squat', '2026-07-01T08:10:00.000Z')])
      querySQL.mockResolvedValueOnce([])

      const history = await store.getWorkoutHistory('2026-06-01')

      expect(history).toHaveLength(2)
      expect(history[1].session.id).toBe('ws-2')
      expect(history[1].exerciseLogs).toEqual([])
    })

    it('short-circuits with no queries beyond the session read when there is no history', async () => {
      querySQL.mockResolvedValueOnce([])
      const history = await store.getWorkoutHistory('2026-06-01')
      expect(history).toEqual([])
      expect(querySQL).toHaveBeenCalledTimes(1)
    })

    it('chunks the IN() list so a large history cannot exceed SQLite\'s parameter cap', async () => {
      const sessions = Array.from({ length: 900 }, (_, i) => sessionRow(`ws-${i}`, '2026-07-01T08:00:00.000Z'))
      querySQL.mockResolvedValueOnce(sessions)
      querySQL.mockResolvedValue([])

      await store.getWorkoutHistory('2026-06-01')

      const inCalls = querySQL.mock.calls.filter(c => String(c[0]).includes('FROM exercise_logs'))
      // 900 ids at a 400 chunk size = 3 statements, none over the cap.
      expect(inCalls).toHaveLength(3)
      for (const c of inCalls) expect((c[1] as unknown[]).length).toBeLessThanOrEqual(400)
    })
  })

  describe('replaceMealTypes / getMealTypes — the offline meal-type mirror', () => {
    beforeEach(() => { vi.clearAllMocks() })

    const mealType = {
      id: 'mt-1', name: 'Breakfast', emoji: '🍳', sortOrder: 0,
      timeStartHour: 6, timeEndHour: 11, remindersEnabled: true, required: true,
    }

    it('replaceMealTypes deletes-all then inserts every row inside one transaction', async () => {
      await store.replaceMealTypes([mealType])
      expect(beginTransaction).toHaveBeenCalledTimes(1)
      expect(commitTransaction).toHaveBeenCalledTimes(1)
      expect(rollbackTransaction).not.toHaveBeenCalled()
      const calls = sqlCalls()
      const deleteIdx = calls.findIndex(s => s.includes('DELETE FROM meal_types'))
      const insertIdx = calls.findIndex(s => s.includes('INTO meal_types'))
      expect(deleteIdx).toBeGreaterThanOrEqual(0)
      expect(insertIdx).toBeGreaterThan(deleteIdx)
      const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO meal_types'))![1] as unknown[]
      expect(params).toEqual(['mt-1', 'Breakfast', '🍳', 0, 6, 11, 1, 1])
    })

    it('replaceMealTypes rolls back and rethrows if an insert fails partway through', async () => {
      runSQL.mockImplementation(async (sql: string) => {
        if (String(sql).includes('INTO meal_types')) throw new Error('disk full')
      })
      await expect(store.replaceMealTypes([mealType])).rejects.toThrow('disk full')
      expect(rollbackTransaction).toHaveBeenCalledTimes(1)
      expect(commitTransaction).not.toHaveBeenCalled()
    })

    it('getMealTypes round-trips 0/1 booleans back to real booleans, ordered by sort_order', async () => {
      querySQL.mockResolvedValueOnce([
        { id: 'mt-2', name: 'Lunch', emoji: '🥗', sort_order: 1, time_start_hour: 11, time_end_hour: 15, reminders_enabled: 0, required: 1 },
      ])
      const [row] = await store.getMealTypes()
      expect(row).toEqual({
        id: 'mt-2', name: 'Lunch', emoji: '🥗', sortOrder: 1,
        timeStartHour: 11, timeEndHour: 15, remindersEnabled: false, required: true,
      })
    })
  })

})
