import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// Q-314, the half the pure classifier cannot cover: that the ingest path actually reads the
// declaration, opens the epoch, and consumes the row — and that an undeclared re-drain leaves the
// epoch alone, which is the behaviour that re-timed the owner's whole sleep history twice.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000314'

const frame = (ds: number) => ({
  ringTimestampDs: ds, tag: 0x76, eventName: 'bedtime_period',
  bodyHex: `76${(ds % 256).toString(16).padStart(2, '0')}0000`, decoded: null,
})

describe.skipIf(!canRun)('a ring re-key is declared, not inferred', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const epochs = async () => (await pool.query(
    `SELECT epoch, anchor_ds FROM oura_ble_clock_anchors WHERE user_id=$1 ORDER BY id`, [TEST_USER_ID])).rows
  const declarations = async () => (await pool.query(
    `SELECT id, consumed_at, opened_epoch FROM oura_ble_rekey_declarations WHERE user_id=$1 ORDER BY id`,
    [TEST_USER_ID])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `rekey-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'oura_ble_rekey_declarations', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id=$1`, [TEST_USER_ID])
    }
  })
  afterAll(async () => {
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'oura_ble_rekey_declarations', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id=$1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  // THE regression. Both events had this shape: a batch replaying history the ring already sent.
  it('a re-drain does NOT open an epoch', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(37_000_000)])
    expect((await epochs()).map(r => r.epoch)).toEqual([0])

    // 33.0M against a 37.0M ceiling — the August event's exact ratio, and the old code opened an
    // epoch here.
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(33_000_000)])
    expect((await epochs()).map(r => r.epoch)).toEqual([0])
  })

  it('a declaration opens the next epoch on the following batch, and is consumed', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(37_000_000)])
    expect((await epochs()).map(r => r.epoch)).toEqual([0])

    const declared = await repo.declareOuraRekey(TEST_USER_ID, 'open_oura re-key on the laptop')
    expect(declared.alreadyPending).toBe(false)
    // Declaring changes nothing until the ring reports — the new ds is not knowable before then.
    expect((await epochs()).map(r => r.epoch)).toEqual([0])

    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(4_000)])
    expect((await epochs()).map(r => r.epoch)).toEqual([0, 1])

    const [row] = await declarations()
    expect(row.consumed_at).not.toBeNull()
    expect(row.opened_epoch).toBe(1)
    expect(await repo.getPendingRekeyDeclaration(TEST_USER_ID)).toBeNull()
  })

  it('opens exactly one epoch, however many batches follow', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(37_000_000)])
    await repo.declareOuraRekey(TEST_USER_ID, null)
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(4_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(8_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(12_000)])
    expect([...new Set((await epochs()).map(r => r.epoch))].sort()).toEqual([0, 1])
  })

  it('declaring twice queues one, not two', async () => {
    const a = await repo.declareOuraRekey(TEST_USER_ID, 'first')
    const b = await repo.declareOuraRekey(TEST_USER_ID, 'second')
    expect(b.alreadyPending).toBe(true)
    expect(b.id).toBe(a.id)
    expect(await declarations()).toHaveLength(1)
  })

  it('a pending declaration can be cancelled; a consumed one cannot', async () => {
    await repo.declareOuraRekey(TEST_USER_ID, null)
    expect(await repo.cancelPendingRekeyDeclaration(TEST_USER_ID)).toBe(true)
    expect(await repo.getPendingRekeyDeclaration(TEST_USER_ID)).toBeNull()
    expect(await repo.cancelPendingRekeyDeclaration(TEST_USER_ID)).toBe(false)

    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(37_000_000)])
    await repo.declareOuraRekey(TEST_USER_ID, null)
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(4_000)])
    // Consumed: the epoch it opened exists and every timestamp derived from it depends on the row.
    expect(await repo.cancelPendingRekeyDeclaration(TEST_USER_ID)).toBe(false)
    expect((await declarations())[0].opened_epoch).toBe(1)
  })

  // The net for a re-key nobody declared. Missing a real one is worse and quieter than the failure
  // this replaces, so counter shape alone still opens an epoch when it genuinely restarted.
  it('an undeclared counter restart still opens an epoch', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(37_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [frame(900)])
    expect((await epochs()).map(r => r.epoch)).toEqual([0, 1])
    expect(await declarations()).toHaveLength(0)
  })

  it('scopes the declaration to one user', async () => {
    const OTHER = '00000000-0000-4000-8000-000000000315'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [OTHER, `rekey-other-${OTHER}@example.com`])
    try {
      await repo.declareOuraRekey(TEST_USER_ID, null)
      expect(await repo.getPendingRekeyDeclaration(OTHER)).toBeNull()
      expect(await repo.cancelPendingRekeyDeclaration(OTHER)).toBe(false)
      expect(await repo.getPendingRekeyDeclaration(TEST_USER_ID)).not.toBeNull()
    } finally {
      await pool.query(`DELETE FROM oura_ble_rekey_declarations WHERE user_id=$1`, [OTHER])
      await pool.query(`DELETE FROM users WHERE id=$1`, [OTHER])
    }
  })
})
