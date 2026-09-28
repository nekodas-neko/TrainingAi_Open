// LA-61 — migration 296 lower-cases and trims stored emails, records a pre-image first, skips any row
// that would collide with another, and builds the case-insensitive unique index only when it can.
//
// It runs in a THROWAWAY DATABASE holding only the two tables the migration touches, for the reason
// la159's guard test gives: DDL on the shared test database locks tables other files are reading.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/296_normalise_emails.sql'), 'utf8')
const PROBE_DB = 'la61_email_probe'

describe.skipIf(!canRun)('migration 296 — email normalisation (LA-61)', () => {
  let admin: Pool
  let probe: Pool

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!)
    url.pathname = '/postgres'
    admin = new Pool({ connectionString: url.toString(), max: 1 })
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${PROBE_DB}`)
    url.pathname = `/${PROBE_DB}`
    probe = new Pool({ connectionString: url.toString(), max: 1 })
  })

  afterAll(async () => {
    if (!canRun) return
    await probe?.end()
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.end()
  })

  /** The pre-296 shape of the two tables. */
  beforeEach(async () => {
    await probe.query(`
      DROP TABLE IF EXISTS users, invited_emails, email_normalisation_preimage;
      CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL UNIQUE);
      CREATE TABLE invited_emails (email text PRIMARY KEY);
    `)
  })

  const emails = async (table: string) =>
    (await probe.query(`SELECT email FROM ${table} ORDER BY email COLLATE "C"`)).rows.map(r => r.email)
  const indexes = async () =>
    (await probe.query(`SELECT indexname FROM pg_indexes WHERE indexname LIKE '%email_lower_key'`)).rows.map(r => r.indexname).sort()
  const preimage = async () =>
    (await probe.query(`SELECT table_name, old_email, new_email FROM email_normalisation_preimage ORDER BY table_name, old_email COLLATE "C"`)).rows

  it('normalises, records the pre-image, and builds both indexes', async () => {
    await probe.query(`INSERT INTO users (email) VALUES ('Alice@Example.com'), (' bob@example.com '), ('carol@example.com')`)
    await probe.query(`INSERT INTO invited_emails (email) VALUES ('Dave@Example.com'), ('erin@example.com')`)
    await probe.query(MIGRATION)
    expect(await emails('users')).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com'])
    expect(await emails('invited_emails')).toEqual(['dave@example.com', 'erin@example.com'])
    expect(await preimage()).toEqual([
      { table_name: 'invited_emails', old_email: 'Dave@Example.com', new_email: 'dave@example.com' },
      { table_name: 'users', old_email: ' bob@example.com ', new_email: 'bob@example.com' },
      { table_name: 'users', old_email: 'Alice@Example.com', new_email: 'alice@example.com' },
    ])
    expect(await indexes()).toEqual(['invited_emails_email_lower_key', 'users_email_lower_key'])
    await expect(probe.query(`INSERT INTO users (email) VALUES ('ALICE@example.com')`)).rejects.toThrow(/users_email_lower_key/)
  })

  it('leaves two accounts that differ only by case exactly as they are, and does not build that index', async () => {
    await probe.query(`INSERT INTO users (email) VALUES ('Sam@Example.com'), ('sam@example.com'), ('Tia@Example.com')`)
    await probe.query(`INSERT INTO invited_emails (email) VALUES ('Uma@Example.com')`)
    await probe.query(MIGRATION)
    // The colliding pair is untouched (the lower-case one was already normal); the lone one is fixed.
    expect(await emails('users')).toEqual(['Sam@Example.com', 'sam@example.com', 'tia@example.com'])
    expect(await indexes()).toEqual(['invited_emails_email_lower_key'])
    expect((await preimage()).map(r => r.old_email)).toEqual(['Uma@Example.com', 'Tia@Example.com'])
  })

  it('skips an invite whose normalised form is already invited', async () => {
    await probe.query(`INSERT INTO invited_emails (email) VALUES ('Vic@Example.com'), ('vic@example.com')`)
    await probe.query(MIGRATION)
    expect(await emails('invited_emails')).toEqual(['Vic@Example.com', 'vic@example.com'])
    expect(await indexes()).toEqual(['users_email_lower_key'])
  })

  it('is a no-op on a second run', async () => {
    await probe.query(`INSERT INTO users (email) VALUES ('Wes@Example.com')`)
    await probe.query(MIGRATION)
    await probe.query(MIGRATION)
    expect(await emails('users')).toEqual(['wes@example.com'])
    expect(await preimage()).toHaveLength(1)
  })
})
