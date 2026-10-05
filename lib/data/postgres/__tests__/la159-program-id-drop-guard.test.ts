// LA-159 — migration 293 drops program_phases.program_id only when no row anywhere holds a value.
// The production measurement behind it could only see the owner's rows (claude_ro is owner-scoped),
// so the guard is what makes the drop safe for every other account.
//
// It runs in a THROWAWAY DATABASE holding only the two objects the migration touches. The first
// version ran the DDL inside a rolled-back transaction on the shared test database, and under the
// full suite it failed with "tuple concurrently updated": ALTER TABLE and DROP VIEW on objects other
// files were reading at the same time. A test that locks its neighbours' tables is a hazard to them
// as well as to itself.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { withDatabase } from './migration-test-lock'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/293_drop_program_phases_program_id.sql'), 'utf8')
const PROBE_DB = 'la159_guard_probe'

describe.skipIf(!canRun)('migration 293 — the program_id drop guard (LA-159)', () => {
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

  /** The pre-293 shape: the column, and a claude_ro view that depends on it. */
  beforeEach(async () => {
    await probe.query(`
      DROP SCHEMA IF EXISTS claude_ro CASCADE;
      DROP TABLE IF EXISTS program_phases;
      CREATE TABLE program_phases (id serial PRIMARY KEY, phase_set_id uuid, program_id uuid);
      CREATE SCHEMA claude_ro;
      CREATE VIEW claude_ro.program_phases AS SELECT id, phase_set_id, program_id FROM program_phases;
    `)
  })

  const hasColumn = async () => (await probe.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'program_phases' AND column_name = 'program_id'`,
  )).rows.length === 1

  it('keeps the column when any row holds a value', async () => {
    await probe.query(`INSERT INTO program_phases (phase_set_id, program_id) VALUES (gen_random_uuid(), NULL), (gen_random_uuid(), gen_random_uuid())`)
    await probe.query(MIGRATION)
    expect(await hasColumn()).toBe(true)
  })

  it('drops the column, and the view that blocked it, when every row is empty', async () => {
    await probe.query(`INSERT INTO program_phases (phase_set_id, program_id) VALUES (gen_random_uuid(), NULL)`)
    await probe.query(MIGRATION)
    expect(await hasColumn()).toBe(false)
  })

  it('is a no-op once the column is gone', async () => {
    await probe.query(MIGRATION)
    await expect(probe.query(MIGRATION)).resolves.toBeDefined()
    expect(await hasColumn()).toBe(false)
  })
})
