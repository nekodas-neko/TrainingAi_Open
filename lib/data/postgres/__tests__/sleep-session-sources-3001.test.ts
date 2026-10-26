// #3001 — a sleep row written without provenance keys must not become an `unknown` device that drops
// out of the per-device normals. Production holds rows with no `source_map` keys at all and rows with
// a heart-rate key but no HRV key. `listSleepSessions` reads a missing key before the switch day as the
// ring, and on a later night as the device of that night's other keys.
//
// Runs only against a real local dev Postgres (DATABASE_URL) and skips without one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003001'

describe.skipIf(!canRun)('listSleepSessions fills missing provenance keys (#3001)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const insert = (date: string, sourceMap: Record<string, string> | null) => pool.query(
    `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, average_hrv_ms, avg_heart_rate, source_map)
     VALUES ($1, $2, $3, $4, 7, 50, 55, $5)`,
    [USER, date, `${date}T00:00:00Z`, `${date}T07:00:00Z`, sourceMap == null ? null : JSON.stringify(sourceMap)])

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'issue-3001@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    // Switch day 2026-10-17: a connected Oura Cloud token created that day, and no Bluetooth frames.
    await pool.query(
      `INSERT INTO oura_tokens (user_id, access_token, created_at) VALUES ($1, 'tok', '2026-10-16T20:00:00Z')`, [USER])
    await insert('2026-10-01', null)                                                                       // no keys, before
    await insert('2026-10-02', { duration_hours: 'oura_ble', avg_heart_rate: 'oura_ble' })                 // no HRV key, before
    await insert('2026-10-03', { duration_hours: 'oura_ble', average_hrv_ms: 'oura_ble', avg_heart_rate: 'oura_ble' })
    await insert('2026-10-20', { duration_hours: 'oura_cloud', avg_heart_rate: 'oura_cloud' })             // no HRV key, after
    await insert('2026-10-21', null)                                                                       // no keys, after
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades the rows
  })

  const byDate = async () => new Map((await repo.listSleepSessions(USER, '2026-10-01', '2026-10-31')).map(r => [r.date, r]))

  it('reads a pre-switch night with no keys as the ring on every key', async () => {
    const r = (await byDate()).get('2026-10-01')!
    expect([r.durationSource, r.hrvSource, r.avgHeartRateSource]).toEqual(['oura_ble', 'oura_ble', 'oura_ble'])
  })

  it('reads a pre-switch night with no HRV key as the ring', async () => {
    expect((await byDate()).get('2026-10-02')!.hrvSource).toBe('oura_ble')
  })

  it('leaves a night that carries all its keys as stored', async () => {
    const r = (await byDate()).get('2026-10-03')!
    expect([r.durationSource, r.hrvSource, r.avgHeartRateSource]).toEqual(['oura_ble', 'oura_ble', 'oura_ble'])
  })

  it('reads a later night with no HRV key as the device of its other keys', async () => {
    expect((await byDate()).get('2026-10-20')!.hrvSource).toBe('oura_cloud')
  })

  it('leaves a later night with no keys at all unknown', async () => {
    const r = (await byDate()).get('2026-10-21')!
    expect([r.durationSource, r.hrvSource, r.avgHeartRateSource]).toEqual([undefined, undefined, undefined])
  })
})
