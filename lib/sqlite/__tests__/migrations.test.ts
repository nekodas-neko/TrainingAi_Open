import { describe, it, expect } from 'vitest'
import { MIGRATIONS, RECONCILE_COLUMNS } from '../migrations'

describe('local schema', () => {
  // The describe and the title used to say v25 while the assertion said 27 — a stale label on a
  // guard whose whole job is to be the authority on the number. Named after what it checks now.
  it('tops out at the current version', () => {
    expect(Math.max(...MIGRATIONS.map(m => m.toVersion))).toBe(32)
  })

  // BF-39. The trap this file exists for: a column added to a `CREATE TABLE IF NOT EXISTS` body
  // reaches FRESH INSTALLS ONLY, because the create is a no-op on a device that already has the
  // table. Both columns need the ALTER as well, and a RECONCILE_COLUMNS row in case it half-applies.
  it('v31 adds the meal columns by ALTER, not only in the CREATE body', () => {
    const v31 = MIGRATIONS.find(m => m.toVersion === 31)!
    const ddl = v31.statements.join('\n')
    expect(ddl).toContain('ALTER TABLE food_logs ADD COLUMN saved_meal_id')
    expect(ddl).toContain('ALTER TABLE food_logs ADD COLUMN meal_group_id')
    for (const column of ['saved_meal_id', 'meal_group_id']) {
      expect(
        RECONCILE_COLUMNS.some(c => c.table === 'food_logs' && c.column === column),
        `food_logs.${column} missing from RECONCILE_COLUMNS`,
      ).toBe(true)
    }
  })

  // BF-3, same shape once more. Five columns across two tables that both already exist on every
  // upgraded device — the dose stamped on a log is what stops a titration rewriting history, so a
  // device that got the CREATE body and not the ALTERs would keep the exact bug this closes.
  it('v32 adds the dose columns by ALTER, not only in the CREATE bodies', () => {
    const v32 = MIGRATIONS.find(m => m.toVersion === 32)!
    const ddl = v32.statements.join('\n')
    for (const [table, column] of [
      ['supplement_logs', 'amount'], ['supplement_logs', 'unit'], ['supplement_logs', 'dose_text'],
      ['supplements', 'default_amount'], ['supplements', 'unit'],
    ] as const) {
      expect(ddl, `${table}.${column} has no ALTER`).toContain(`ALTER TABLE ${table} ADD COLUMN ${column}`)
      expect(
        RECONCILE_COLUMNS.some(c => c.table === table && c.column === column),
        `${table}.${column} missing from RECONCILE_COLUMNS`,
      ).toBe(true)
    }
  })

  it('v23 creates the meal-plan tables without any ALTER', () => {
    const v23 = MIGRATIONS.find(m => m.toVersion === 23)!
    const ddl = v23.statements.join('\n')
    for (const t of ['meal_plans', 'meal_plan_variants', 'meal_plan_meals']) {
      expect(ddl, `v23 missing ${t}`).toContain(`CREATE TABLE IF NOT EXISTS ${t}`)
    }
    // ADD COLUMN is not idempotent: a retried partial upgrade throws "duplicate column" and rolls
    // the whole version back, which is how the local DB has died on Android twice.
    expect(ddl).not.toContain('ADD COLUMN')
  })

  it('v23 stores names and macros locally, not just ids', () => {
    const ddl = MIGRATIONS.find(m => m.toVersion === 23)!.statements.join('\n')
    // A local table holding only foreign keys cannot render offline — the food_logs -> food_items
    // gap was this project's worst data-loss bug.
    for (const col of ['name', 'target_calories', 'target_protein_g', 'target_carbs_g', 'target_fat_g']) {
      expect(ddl, `meal_plan_meals missing ${col}`).toContain(col)
    }
  })

  it('v24 gives meal_plan_meals the columns that make a saved plan editable', () => {
    // Q-192: without the ingredient snapshot there is nothing to re-scale, replace or render, so
    // per-meal editing could not exist on a saved plan. These MUST be ALTERs — adding them to the
    // CREATE body alone reaches fresh installs only, never the device that already ran v23.
    const v24 = MIGRATIONS.find(m => m.toVersion === 24)!
    const ddl = v24.statements.join('\n')
    expect(ddl).toContain('ALTER TABLE meal_plan_meals ADD COLUMN ingredients')
    expect(ddl).toContain('ALTER TABLE meal_plan_meals ADD COLUMN suggested_time')
  })

  it('v25 adds the saved-meal batch size as an ALTER, with a default of one', () => {
    // Same three-part rule as v24. The DEFAULT 1 is the load-bearing half: every saved meal that
    // already exists on the device gets this column with no value of its own, and anything other
    // than 1 would silently change what "Log this meal" writes.
    const ddl = MIGRATIONS.find(m => m.toVersion === 25)!.statements.join('\n')
    expect(ddl).toContain('ALTER TABLE saved_meals ADD COLUMN servings')
    expect(ddl).toContain('DEFAULT 1')
  })

  it('v25 registers servings in RECONCILE_COLUMNS, the authority after a partial upgrade', () => {
    expect(RECONCILE_COLUMNS.some(c => c.table === 'saved_meals' && c.column === 'servings')).toBe(true)
  })

  it('v13 adds the outbox retry columns and activity sync_status', () => {
    const v13 = MIGRATIONS.find(m => m.toVersion === 13)!
    const ddl = v13.statements.join('\n')
    for (const col of ['attempts', 'last_error', 'status', 'next_retry_at']) {
      expect(ddl, `mutations_outbox missing ${col}`).toContain(`ALTER TABLE mutations_outbox ADD COLUMN ${col}`)
    }
    expect(ddl).toContain('ALTER TABLE activity_logs ADD COLUMN sync_status')
  })

  it('v14 creates the fitness_tests table', () => {
    const v14 = MIGRATIONS.find(m => m.toVersion === 14)!
    expect(v14.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS fitness_tests')
  })

  it('v15 creates the prescribed_runs table', () => {
    const v15 = MIGRATIONS.find(m => m.toVersion === 15)!
    expect(v15.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS prescribed_runs')
  })

  it('v17 creates the Oura raw-on-device calculated-form tables', () => {
    const v17 = MIGRATIONS.find(m => m.toVersion === 17)!
    expect(v17.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS oura_bucket')
  })

  it('v18 recreates the Oura calculated-form tables with the corrected bucket PK', () => {
    const v18 = MIGRATIONS.find(m => m.toVersion === 18)!
    const ddl = v18.statements.join('\n')
    expect(ddl).toContain('DROP TABLE IF EXISTS oura_bucket')
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS oura_bucket')
  })

  it('registers the reconcile-only planned-snapshot columns on set_logs', () => {
    const mirror = new Set(RECONCILE_COLUMNS.map(c => `${c.table}.${c.column}`))
    expect(mirror.has('set_logs.planned_pct')).toBe(true)
    expect(mirror.has('set_logs.planned_rest_sec')).toBe(true)
    // Q-14: the v19 ALTER is not idempotent, so a partially-applied upgrade leaves the column
    // missing and only reconcileSchema can put it back.
    expect(mirror.has('set_logs.planned_reps')).toBe(true)
  })

  it('v20 creates the exercise_library mirror', () => {
    // Q-20: without it every offline read typed an exercise as 'weighted'. RECONCILE_TABLES
    // carries the same CREATE and is the real authority after a partial upgrade.
    const v20 = MIGRATIONS.find(m => m.toVersion === 20)!
    expect(v20.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS exercise_library')
  })

  it('v21 creates the meal_types mirror', () => {
    // Without it, a food log opened offline once the generic response cache expires has no
    // meal-type name/emoji to group under. RECONCILE_TABLES carries the same CREATE and is
    // the real authority after a partial upgrade.
    const v21 = MIGRATIONS.find(m => m.toVersion === 21)!
    expect(v21.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS meal_types')
  })

  it('v22 gives supplements the two columns applyDelta gates on', () => {
    // Q-124: supplements was the only write domain whose applyDelta arm could not gate on
    // sync_status, because the column did not exist — so a rename made offline reverted to the
    // server's old value on the next pull. RECONCILE_COLUMNS carries both and is the real
    // authority after a partial upgrade.
    const v22 = MIGRATIONS.find(m => m.toVersion === 22)!
    const ddl = v22.statements.join('\n')
    expect(ddl).toContain('ALTER TABLE supplements ADD COLUMN deleted_at')
    expect(ddl).toContain('ALTER TABLE supplements ADD COLUMN sync_status')
  })

  it('v19 adds the prescribed-reps column to set_logs', () => {
    const v19 = MIGRATIONS.find(m => m.toVersion === 19)!
    expect(v19.statements.join('\n')).toContain('ALTER TABLE set_logs ADD COLUMN planned_reps')
  })

  // Regression for a real on-device outage (2026-07-23): #725 extended
  // CREATE_OURA_DAILY_SUMMARY_LOCAL/CREATE_OURA_DAILY_DERIVED_LOCAL with baseline/derived
  // columns behind a v18 corrective DROP+CREATE, but a device that had already advanced
  // past v18 before #725 shipped never re-runs it — the schema-version bump alone cannot
  // self-heal an already-upgraded device. Sync then failed with "no such column:
  // hrv_baseline_mean_x8" because the new columns were never registered in
  // RECONCILE_COLUMNS, which is the only mechanism that runs on EVERY open (not once per
  // version) and can actually fix a device stuck on the old schema.
  it('registers every #725 baseline/derived column added to oura_daily_summary/derived (2026-07-23 outage guard)', () => {
    const mirror = new Set(RECONCILE_COLUMNS.map(c => `${c.table}.${c.column}`))
    const summaryCols = [
      'hrv_baseline_mean_x8', 'hrv_baseline_dev_x8', 'rhr_baseline_mean_x8', 'rhr_baseline_dev_x8',
      'temp_baseline_mean_x8', 'temp_baseline_dev_x8', 'sleep_baseline_mean_x8', 'sleep_baseline_dev_x8',
      'met_baseline_mean_x8', 'met_baseline_dev_x8', 'breath_baseline_mean_x8', 'breath_baseline_dev_x8',
      'n_history',
    ]
    for (const col of summaryCols) {
      expect(mirror.has(`oura_daily_summary.${col}`), `RECONCILE_COLUMNS missing oura_daily_summary.${col}`).toBe(true)
    }
    const derivedCols = [
      'readiness_source', 'activity_contributors', 'training_load_high', 'worn_hours_ble',
      'night_hrv_baseline_ms', 'illness_biomarkers', 'stress_high_minutes', 'recovery_high_minutes',
      'chronic_stress_contributors', 'resilience_daily_stress', 'resilience_daily_restorative_time',
      'resilience_daily_sleep_recovery', 'resilience_granular', 'resilience_confidence',
      'vascular_age', 'pwv', 'body_comp',
    ]
    for (const col of derivedCols) {
      expect(mirror.has(`oura_daily_derived.${col}`), `RECONCILE_COLUMNS missing oura_daily_derived.${col}`).toBe(true)
    }
  })

  it('every ALTER-added column is mirrored in RECONCILE_COLUMNS (bug #85 guard)', () => {
    const mirror = new Set(RECONCILE_COLUMNS.map(c => `${c.table}.${c.column}`))
    for (const mig of MIGRATIONS) {
      for (const stmt of mig.statements) {
        // Case-insensitive on purpose: initSQLite now stamps user_version forward after a clean
        // reconcile, which retires the versioned upgrade path — so a column this scan misses would
        // never be applied again. Every statement in the tree is uppercase today; the flag stops a
        // future lowercase one from silently escaping the guard.
        const m = stmt.match(/ALTER TABLE (\w+)\s+ADD COLUMN (\w+)/i)
        if (m) expect(mirror.has(`${m[1]}.${m[2]}`), `RECONCILE_COLUMNS missing ${m[1]}.${m[2]}`).toBe(true)
      }
    }
  })
})
