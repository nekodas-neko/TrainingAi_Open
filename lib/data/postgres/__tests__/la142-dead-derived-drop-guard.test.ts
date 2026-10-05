// LA-142 — migration 294 drops four dead oura_daily_derived columns, each only when no row anywhere
// holds a value in it. The production measurement could only see the owner's rows, so the guard is
// what keeps the drop from destroying another account's data. Runs in a throwaway database holding
// only what the migration touches, for the reason LA-159's guard test records: DDL on the shared
// test database locks tables other files are reading.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { withDatabase } from './migration-test-lock'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/294_drop_dead_derived_columns.sql'), 'utf8')
const PROBE_DB = 'la142_guard_probe'
const DEAD = ['active_calories_est', 'worn_hours_ble', 'vascular_age', 'pwv']

describe.skipIf(!canRun)('migration 294 — the dead derived columns drop guard (LA-142)', () => {
  let admin: Pool
  let probe: Pool

  beforeAll(async () => {
    admin = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, 'postgres'), max: 1 })
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${PROBE_DB}`)
    probe = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, PROBE_DB), max: 1 })
    // Teardown drops this database WITH (FORCE), which terminates any client still closing with
    // 57P01. Without a listener that error is unhandled and fails the whole run (LB-177).
    probe.on('error', () => {})
  })

  afterAll(async () => {
    if (!canRun) return
    await probe?.end()
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.end()
  })

  beforeEach(async () => {
    await probe.query(`
      DROP SCHEMA IF EXISTS claude_ro CASCADE;
      DROP TABLE IF EXISTS oura_daily_derived;
      CREATE TABLE oura_daily_derived (day date PRIMARY KEY, sleep_score integer,
        active_calories_est integer, worn_hours_ble double precision,
        vascular_age double precision, pwv double precision);
      CREATE SCHEMA claude_ro;
      CREATE VIEW claude_ro.oura_daily_derived AS
        SELECT day, sleep_score, active_calories_est, worn_hours_ble, vascular_age, pwv FROM oura_daily_derived;
    `)
  })

  const columns = async () => (await probe.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oura_daily_derived' ORDER BY ordinal_position`,
  )).rows.map(r => r.column_name as string)

  it('drops all four when every row is empty, and keeps the live column', async () => {
    await probe.query(`INSERT INTO oura_daily_derived (day, sleep_score) VALUES ('2026-09-01', 80)`)
    await probe.query(MIGRATION)
    expect(await columns()).toEqual(['day', 'sleep_score'])
  })

  it('keeps exactly the column that holds a value, and drops the other three', async () => {
    await probe.query(`INSERT INTO oura_daily_derived (day, pwv) VALUES ('2026-09-01', 7.2)`)
    await probe.query(MIGRATION)
    const cols = await columns()
    expect(cols).toContain('pwv')
    for (const c of DEAD.filter(c => c !== 'pwv')) expect(cols).not.toContain(c)
  })

  it('is a no-op once the columns are gone', async () => {
    await probe.query(MIGRATION)
    await expect(probe.query(MIGRATION)).resolves.toBeDefined()
    expect(await columns()).toEqual(['day', 'sleep_score'])
  })
})
