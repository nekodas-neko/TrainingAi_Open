// LA-71 (#2196) — migration 202610071236 deletes exact duplicate `scale_raw_samples` rows (same
// user, same instant, byte-identical raw_hex; lowest id kept) and then builds the unique index.
// It deletes rows, so what it must NOT delete is pinned as hard as what it must.
//
// It runs in a THROWAWAY DATABASE holding only the two tables the migration touches, for the reason
// la61's test gives: DDL on the shared test database locks tables other files are reading.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { withDatabase } from './migration-test-lock'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(
  join(process.cwd(), 'lib/data/postgres/migrations/202610071236_scale_raw_samples_unique_key.sql'), 'utf8')
const PROBE_DB = 'la71_scale_unique_probe'
const INDEX = 'scale_raw_samples_user_measured_raw_uq'

const A = '00000000-0000-4000-8000-0000000071a1'
const B = '00000000-0000-4000-8000-0000000071b2'
const C = '00000000-0000-4000-8000-0000000071c3'
const T1 = '2026-09-01T21:10:00Z'
const T2 = '2026-09-02T21:10:00Z'

describe.skipIf(!canRun)('migration 202610071236 — scale_raw_samples unique key (LA-71)', () => {
  let admin: Pool
  let probe: Pool

  beforeAll(async () => {
    admin = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, 'postgres'), max: 1 })
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${PROBE_DB}`)
    probe = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, PROBE_DB), max: 2 })
    // Teardown drops this database WITH (FORCE), which terminates any client still closing with
    // 57P01. Without a listener that error is unhandled and fails the whole run.
    probe.on('error', () => {})
  })

  afterAll(async () => {
    if (!canRun) return
    await probe?.end()
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.end()
  })

  /** The pre-migration shape: migration 157's table and both of its non-unique indexes. */
  beforeEach(async () => {
    await probe.query(`
      DROP TABLE IF EXISTS scale_raw_samples, users;
      CREATE TABLE users (id uuid PRIMARY KEY);
      INSERT INTO users (id) VALUES ('${A}'), ('${B}'), ('${C}');
      CREATE TABLE scale_raw_samples (
        id          BIGSERIAL PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        measured_at TIMESTAMPTZ NOT NULL,
        raw_hex     TEXT NOT NULL,
        decoded     JSONB,
        status      TEXT NOT NULL DEFAULT 'confirmed',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_scale_raw_samples_user_time ON scale_raw_samples (user_id, measured_at DESC);
      CREATE INDEX idx_scale_raw_samples_user_status ON scale_raw_samples (user_id, status);
    `)
  })

  /** Inserts rows in order and returns their ids, so a test can name exactly which ones survive. */
  const seed = async (rows: Array<[user: string, at: string, hex: string, status?: string, decoded?: object | null]>) => {
    const ids: number[] = []
    for (const [user, at, hex, status = 'confirmed', decoded = { weightKg: 72.4 }] of rows) {
      const { rows: [r] } = await probe.query<{ id: string }>(
        `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, decoded, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user, at, hex, decoded === null ? null : JSON.stringify(decoded), status])
      ids.push(Number(r.id))
    }
    return ids
  }
  const survivingIds = async () =>
    (await probe.query<{ id: string }>(`SELECT id FROM scale_raw_samples ORDER BY id`)).rows.map(r => Number(r.id))
  const indexExists = async () =>
    (await probe.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [INDEX])).rowCount === 1
  const indexComment = async () =>
    (await probe.query<{ c: string | null }>(
      `SELECT obj_description(to_regclass($1), 'pg_class') AS c`, [`public.${INDEX}`])).rows[0].c

  /** Runs the migration on one client, capturing its NOTICEs — the count the owner compares. */
  const runMigration = async () => {
    const client = await probe.connect()
    const notices: string[] = []
    const onNotice = (n: { message?: string }) => { if (n.message) notices.push(n.message) }
    client.on('notice', onNotice)
    try {
      await client.query(MIGRATION)
      return notices
    } finally {
      client.off('notice', onNotice)
      client.release()
    }
  }

  it('deletes exactly the exact duplicates, keeps the lowest id of each group, and builds the index', async () => {
    const ids = await seed([
      [A, T1, 'aabbcc01'],                                  // 0  group 1 — kept
      [A, T1, 'aabbcc01'],                                  // 1  group 1 — deleted
      [A, T1, 'aabbcc01'],                                  // 2  group 1 — deleted (a group of three)
      [A, T1, 'aabbcc02'],                                  // 3  differs by ONE byte — survives
      [A, T2, 'aabbcc01'],                                  // 4  same bytes, another instant — survives
      [B, T1, 'aabbcc01'],                                  // 5  same bytes and instant, another user — survives
      [B, T2, 'ddeeff00', 'pending'],                       // 6  group 2 — kept
      [B, T2, 'ddeeff00', 'pending', { weightKg: 60.1 }],   // 7  group 2 — deleted (decoded-only difference)
      [C, T1, 'AABBCC01'],                                  // 8  same letters, different case: different bytes as text — survives
    ])

    const notices = await runMigration()

    expect(await survivingIds()).toEqual([ids[0], ids[3], ids[4], ids[5], ids[6], ids[8]])
    expect(await indexExists()).toBe(true)
    expect(notices.join('\n')).toMatch(/deleted 3 exact duplicate scale_raw_samples row\(s\) across 2 account\(s\), of 9 rows \(predicted 3\); 1 group\(s\) differed only in decoded/)
    expect(await indexComment()).toMatch(/^LA-71 \(#2196\), built .*: deleted 3 exact duplicate row\(s\) across 2 account\(s\), of 9 rows; 1 group\(s\) differed only in decoded$/)
    // And the index now refuses the exact duplicate it was built for.
    await expect(seed([[A, T1, 'aabbcc01']])).rejects.toThrow(new RegExp(INDEX))
  })

  it('deletes nothing on a clean table, and says so', async () => {
    const ids = await seed([[A, T1, 'aabbcc01'], [A, T2, 'aabbcc01'], [B, T1, 'aabbcc01']])
    const notices = await runMigration()
    expect(await survivingIds()).toEqual(ids)
    expect(await indexExists()).toBe(true)
    expect(notices.join('\n')).toMatch(/deleted 0 exact duplicate .* of 3 rows \(predicted 0\)/)
    expect(await indexComment()).toMatch(/deleted 0 exact duplicate row\(s\) across 0 account\(s\), of 3 rows/)
  })

  it('is a no-op on a second run, and keeps the first run\'s recorded count', async () => {
    await seed([[A, T1, 'aabbcc01'], [A, T1, 'aabbcc01']])
    await runMigration()
    const comment = await indexComment()
    const notices = await runMigration()
    expect((await survivingIds()).length).toBe(1)
    expect(notices.join('\n')).toMatch(/already exists; deleted 0 rows/)
    expect(await indexComment()).toBe(comment)
  })

  it('refuses to run, deleting nothing, when a duplicate group disagrees on status', async () => {
    // `status` is the user's own confirm/not-me answer. Keeping the lowest id here would put a
    // pending prompt back in front of someone who already confirmed that reading.
    const ids = await seed([
      [A, T1, 'aabbcc01', 'pending'],
      [A, T1, 'aabbcc01', 'confirmed'],
      [B, T1, 'ddeeff00'],
      [B, T1, 'ddeeff00'],
    ])
    await expect(runMigration()).rejects.toMatchObject({
      code: 'P0001', message: expect.stringMatching(/1 duplicate group\(s\) .* disagree on status; nothing deleted/),
    })
    expect(await survivingIds()).toEqual(ids)
    expect(await indexExists()).toBe(false)
  })

  it('after the index, two simultaneous inserts of the same frame on two connections leave one row', async () => {
    await runMigration()
    // Two transactions both inside their INSERT before either commits: the case the pre-check could
    // not close, because both of its selects would have found nothing.
    const one = await probe.connect()
    const two = await probe.connect()
    try {
      const insert = `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, status)
                      VALUES ($1, $2, $3, 'confirmed') ON CONFLICT DO NOTHING RETURNING id`
      await one.query('BEGIN')
      await two.query('BEGIN')
      const first = await one.query(insert, [A, T1, 'aabbcc01'])
      const secondPending = two.query(insert, [A, T1, 'aabbcc01']) // blocks on `one`'s uncommitted row
      await one.query('COMMIT')
      const second = await secondPending
      await two.query('COMMIT')
      expect(first.rowCount).toBe(1)
      expect(second.rowCount).toBe(0)
    } finally {
      one.release()
      two.release()
    }
    const { rows } = await probe.query(`SELECT count(*)::int AS n FROM scale_raw_samples`)
    expect(rows[0].n).toBe(1)
  })
})
