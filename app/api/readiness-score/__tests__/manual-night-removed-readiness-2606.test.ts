// Issue 2606 — removing a typed night, end to end through the real readiness route. A removed night
// must leave the score as if it had never been entered: for a user whose only night it was, the
// sleep component goes away again and every computed field matches the pre-entry payload; for a user
// whose ring recorded that night, the payload is byte-identical throughout. The second case is also
// the "a user who never removes anything is unaffected" guarantee: their reads see the same rows.
//
// Runs only against a real Postgres (DATABASE_URL) — skips cleanly without one.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const NO_DEVICE = '00000000-0000-4000-8000-000000002608'
const WITH_RING = '00000000-0000-4000-8000-000000002609'
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
const TODAY = '2026-10-07'
const BED  = '2026-10-06T12:30:00.000Z'          // 22:30 Brisbane
const WAKE = '2026-10-06T20:30:00.000Z'          // 06:30 Brisbane — an 8 h night waking today

const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: session.userId, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('readiness after a typed night is removed (issue 2606)', () => {
  let pool: import('pg').Pool

  const asUser = (id: string) => { session.userId = id }
  const readiness = async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    return res.text()
  }
  const manual = async (method: 'POST' | 'DELETE', body: unknown) => {
    const route = await import('@/app/api/sleep-sessions/manual/route')
    const res = await route[method](new Request('http://localhost/api/sleep-sessions/manual', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
    expect(res.status).toBe(200)
    return res.json()
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const { getPool } = await import('@/lib/data/postgres/client')
    const { shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    for (const id of [NO_DEVICE, WITH_RING]) {
      await pool.query('DELETE FROM users WHERE id = $1', [id])
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`,
        [id, `manual-night-removed-${id}@example.com`, TZ])
      for (let i = 1; i <= 60; i++) {
        await pool.query(
          `INSERT INTO body_metrics (user_id, date, weight_kg, steps) VALUES ($1,$2,$3,$4)`,
          [id, shiftDateStr(TODAY, -i), 80 + (i % 3) * 0.2, 6000 + (i % 7) * 500])
      }
    }
    // The ring user has a measured history, so the score is a real one with a sleep component.
    for (let i = 0; i <= 14; i++) {
      const wake = shiftDateStr(TODAY, -i)
      const start = new Date(new Date(`${wake}T00:00:00+10:00`).getTime() - (110 - (i % 4) * 5) * 60_000)
      const end = new Date(new Date(`${wake}T06:00:00+10:00`).getTime() + (i % 3) * 10 * 60_000)
      await pool.query(
        `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency,
                                     onset_latency_sec, average_hrv_ms, avg_heart_rate, oura_id, source_map)
         VALUES ($1,$2,$3,$4,$5,$6,600,$7,54,$8,$9)`,
        [WITH_RING, wake, start, end, 6.5 + (i % 4) * 0.25, 85 + (i % 5), 45 + (i % 6),
         `ble:2609-${i}`, JSON.stringify({ duration_hours: 'oura_ble', efficiency: 'oura_ble' })])
    }
  })

  afterEach(() => { session.userId = '' })

  afterAll(async () => {
    vi.useRealTimers()
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[NO_DEVICE, WITH_RING]]) // cascades
  })

  it('no device: the sleep component appears with the typed night and the score returns when it is removed', async () => {
    asUser(NO_DEVICE)
    const before = JSON.parse(await readiness())
    expect(before.sleepScore).toBeNull()

    const { id } = await manual('POST', { sleepStart: BED, sleepEnd: WAKE })
    const entered = JSON.parse(await readiness())
    expect(entered.sleepScore).not.toBeNull()
    expect(entered.components.sleep).toBeGreaterThan(0)

    expect(await manual('DELETE', { id })).toMatchObject({ removed: true })
    const after = JSON.parse(await readiness())
    // Every field the readiness read computes is back where it was. The one difference is not a
    // score: while the night existed the route PERSISTED its scores into oura_daily_derived for
    // today, and `ownResilienceUnavailable.daysSeen` counts that stored row. Whether a removal should
    // also clear the stored sleep score is an owner question (issue 2660); this pins today's state so
    // a fix for it announces itself here.
    expect(after.ownResilienceUnavailable.daysSeen).toBe(before.ownResilienceUnavailable.daysSeen + 1)
    expect({ ...after, ownResilienceUnavailable: null }).toEqual({ ...before, ownResilienceUnavailable: null })
    const { rows: [stored] } = await pool.query(
      `SELECT sleep_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [NO_DEVICE, TODAY])
    expect(stored?.sleep_score).toBe(entered.sleepScore)
  })

  it('with a ring: entering and removing the shadowed typed night never moves the score', async () => {
    asUser(WITH_RING)
    // The first call persists today's own bookkeeping (the resilience model counts the day as seen);
    // the baseline is the second, so the comparison is about sleep and nothing else.
    await readiness()
    const before = await readiness()
    expect(JSON.parse(before).sleepScore).not.toBeNull()

    const { id, shadowed } = await manual('POST', { sleepStart: BED, sleepEnd: WAKE })
    expect(shadowed).toBe(true)
    expect(await readiness()).toBe(before)
    await manual('DELETE', { id })
    expect(await readiness()).toBe(before)
  })
})
