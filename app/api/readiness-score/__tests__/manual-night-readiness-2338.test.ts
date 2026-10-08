// #2338 — the point of manual sleep entry, end to end through the real readiness route: a user with
// no ring and no Health Connect gets a sleep component from a night they typed in, and a user whose
// ring recorded the same night is scored on the ring's night, never the typed one.
//
// Runs only against a real Postgres (DATABASE_URL) — skips cleanly without one.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const NO_DEVICE = '00000000-0000-4000-8000-000000002340'
const WITH_RING = '00000000-0000-4000-8000-000000002341'
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
const TODAY = '2026-10-07'
const BED  = '2026-10-06T12:30:00.000Z'          // 22:30 Brisbane
const WAKE = '2026-10-06T20:30:00.000Z'          // 06:30 Brisbane — an 8 h night waking today

const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: session.userId, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('readiness sleep component from a hand-entered night (#2338)', () => {
  let pool: import('pg').Pool

  const asUser = (id: string) => { session.userId = id }
  const readiness = async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    return res.json()
  }
  const enterNight = async () => {
    const { POST } = await import('@/app/api/sleep-sessions/manual/route')
    const res = await POST(new Request('http://localhost/api/sleep-sessions/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sleepStart: BED, sleepEnd: WAKE }),
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
        [id, `manual-night-readiness-${id}@example.com`, TZ])
      // Sixty days of history with no sleep in it at all: weight and steps, as a phone with no ring
      // and no Health Connect would log them by hand.
      for (let i = 1; i <= 60; i++) {
        await pool.query(
          `INSERT INTO body_metrics (user_id, date, weight_kg, steps) VALUES ($1,$2,$3,$4)`,
          [id, shiftDateStr(TODAY, -i), 80 + (i % 3) * 0.2, 6000 + (i % 7) * 500])
      }
    }
    // The ring's night for the same date: shorter, and measured (efficiency and onset present).
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency,
                                   onset_latency_sec, oura_id, source_map)
       VALUES ($1,$2,$3,$4,6.5,91,600,'ble:2341',$5)`,
      [WITH_RING, TODAY, '2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z',
       JSON.stringify({ duration_hours: 'oura_ble', efficiency: 'oura_ble' })])
  })

  afterEach(() => { session.userId = '' })

  afterAll(async () => {
    vi.useRealTimers()
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[NO_DEVICE, WITH_RING]]) // cascades
  })

  it('a user with no device has no sleep component until a night is entered', async () => {
    asUser(NO_DEVICE)
    const before = await readiness()
    expect(before.sleepScore).toBeNull()
    expect(before.components.sleep).toBe(0)
  })

  it('the entered night fills the sleep component and is scored on what it carries', async () => {
    asUser(NO_DEVICE)
    expect((await enterNight()).shadowed).toBe(false)
    const body = await readiness()
    expect(body.sleepScore).not.toBeNull()
    expect(body.sleepScore).toBeGreaterThan(0)
    expect(body.components.sleep).toBeGreaterThan(0)
    expect(body.inputsAvailable).toContain('sleep')
    // Nothing measured is invented for it: efficiency, latency and stages are reported missing.
    expect(body.sleepScoreCoverage.missing).toEqual(expect.arrayContaining(['efficiency', 'latency', 'rem', 'deep']))
    expect(body.sleepContributors).toHaveProperty('total_sleep')
    expect(body.sleepContributors).not.toHaveProperty('efficiency')
  })

  it('a user whose ring recorded the same night is scored on the ring night, not the entered one', async () => {
    asUser(WITH_RING)
    const ringOnly = await readiness()
    expect(ringOnly.sleepScore).not.toBeNull()

    expect((await enterNight()).shadowed).toBe(true)
    const body = await readiness()
    // Exactly the ring night's score: the manual 8 h night did not replace it or merge into it.
    expect(body.sleepScore).toBe(ringOnly.sleepScore)
    expect(body.components.sleep).toBe(ringOnly.components.sleep)
    expect(body.sleepScoreCoverage.missing).not.toContain('efficiency')
    expect(body.sleepContributors).toHaveProperty('efficiency')
  })
})
