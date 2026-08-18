import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { packFrames, unpackFrames, hexToBody, bodyToHex } from '@/lib/oura-ble/frame-pack'

// Q-541. The codec's own tests prove pack/unpack is reversible in memory. This proves the other
// half — that a blob survives the `bytea` column, the pg driver and Drizzle unchanged. That is the
// join where a byte-level format usually breaks (an encoding applied on the way in, a Buffer handed
// back as a string), and the archival guarantee in CLAUDE.md rests on it holding.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054100'

describe.skipIf(!canRun)('oura_raw_packed — a blob survives Postgres byte for byte', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `packed-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  // The owner's five oldest tag-0x76 frames, read from claude_ro on 2026-08-17.
  const production = [
    { ds: 1_666_556, hex: 'd47e16008fac1600' },
    { ds: 2_329_363, hex: 'e9161d009e662100' },
    { ds: 2_845_957, hex: 'f38b2800b0ac2800' },
    { ds: 2_883_160, hex: 'acf72800053e2900' },
    { ds: 3_183_149, hex: '31ce2900207e2e00' },
  ]

  it('stores and returns the exact bytes, and the frames unpack unchanged', async () => {
    const blob = packFrames(production.map(p => ({ ds: p.ds, body: hexToBody(p.hex) })))
    await pool.query(
      `INSERT INTO oura_raw_packed
         (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1, 0, 118, $2, $3, $4, $5, 'sha-not-checked-here', $6)`,
      [TEST_USER_ID, Math.floor(production[0].ds / 864_000), production.length,
       production[0].ds, production[production.length - 1].ds, Buffer.from(blob)],
    )

    const { rows } = await pool.query(
      `SELECT blob, frame_count FROM oura_raw_packed WHERE user_id = $1`, [TEST_USER_ID])
    expect(rows).toHaveLength(1)

    const returned = new Uint8Array(rows[0].blob as Buffer)
    expect(bodyToHex(returned)).toBe(bodyToHex(blob))          // byte-identical
    expect(rows[0].frame_count).toBe(production.length)

    expect(unpackFrames(returned).map(f => ({ ds: f.ds, hex: bodyToHex(f.body) })))
      .toEqual(production.map(p => ({ ds: p.ds, hex: p.hex })))
  })

  it('one bucket is one row — the primary key is what enforces that', async () => {
    const dup = () => pool.query(
      `INSERT INTO oura_raw_packed
         (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1, 0, 118, $2, 1, 1, 1, 'x', $3)`,
      [TEST_USER_ID, Math.floor(production[0].ds / 864_000), Buffer.from([1, 2, 3])],
    )
    await expect(dup()).rejects.toThrow(/duplicate key/)
  })
})
