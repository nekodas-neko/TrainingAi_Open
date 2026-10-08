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
    // score: while the night existed the route PERSISTED today's row into oura_daily_derived, and
    // `ownResilienceUnavailable.daysSeen` counts that stored row (readiness is deliberately kept:
    // it records what the app said). The stored SLEEP score and contributors were the night's, and
    // issue 2660 clears them in the same write as the removal.
    expect(after.ownResilienceUnavailable.daysSeen).toBe(before.ownResilienceUnavailable.daysSeen + 1)
    expect({ ...after, ownResilienceUnavailable: null }).toEqual({ ...before, ownResilienceUnavailable: null })
    const { rows: [stored] } = await pool.query(
      `SELECT sleep_score, sleep_contributors, readiness_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [NO_DEVICE, TODAY])
    expect(stored.sleep_score).toBeNull()
    expect(stored.sleep_contributors).toBeNull()
    expect(stored.readiness_score).not.toBeNull()

    // A later read for a date that now has no night does not refill the score from the COALESCE
    // merge, and the row still carries the readiness it recorded.
    await readiness()
    const { rows: [again] } = await pool.query(
      `SELECT sleep_score, sleep_contributors, readiness_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [NO_DEVICE, TODAY])
    expect(again).toEqual(stored)

    // Entering the night again and reading recomputes the stored score.
    await manual('POST', { sleepStart: BED, sleepEnd: WAKE })
    const reentered = JSON.parse(await readiness())
    expect(reentered.sleepScore).toBe(entered.sleepScore)
    const { rows: [back] } = await pool.query(
      `SELECT sleep_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [NO_DEVICE, TODAY])
    expect(back.sleep_score).toBe(entered.sleepScore)
  })

  it('removal leaves the verdict row byte-equal and clears only the sleep columns', async () => {
    const U = '00000000-0000-4000-8000-000000002661'
    await pool.query('DELETE FROM users WHERE id = $1', [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, 'clear-2660@example.com', TZ])
    try {
      asUser(U)
      const { id } = await manual('POST', { sleepStart: BED, sleepEnd: WAKE })
      await pool.query(
        `INSERT INTO oura_daily_derived (user_id, day, sleep_score, sleep_contributors, readiness_score, activity_score, source)
         VALUES ($1,$2,81,'{"x":1}'::jsonb,77,66,'t')`, [U, TODAY])
      await pool.query(
        `INSERT INTO sleep_verdicts (user_id, date, verdict, baseline_nights, model_version, response_state)
         VALUES ($1,$2,'good',20,1,'acknowledged')`, [U, TODAY])
      const verdictSql = `SELECT to_jsonb(v) AS row FROM sleep_verdicts v WHERE user_id = $1`
      const verdictBefore = (await pool.query(verdictSql, [U])).rows[0].row
      expect(await manual('DELETE', { id })).toMatchObject({ removed: true })
      const { rows: [d] } = await pool.query(
        `SELECT sleep_score, sleep_contributors, readiness_score, activity_score, source FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [U, TODAY])
      expect(d).toEqual({ sleep_score: null, sleep_contributors: null, readiness_score: 77, activity_score: 66, source: 't' })
      expect((await pool.query(verdictSql, [U])).rows[0].row).toEqual(verdictBefore)
      // A replay changes nothing: no second write, so updated_at does not move.
      const stamp = async () => (await pool.query(`SELECT updated_at FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [U, TODAY])).rows[0].updated_at.getTime()
      const t0 = await stamp()
      expect(await manual('DELETE', { id })).toMatchObject({ alreadyRemoved: true })
      expect(await stamp()).toBe(t0)
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [U])
    }
  })

  it('removal clears nothing for another user\'s row on the same date', async () => {
    const A = '00000000-0000-4000-8000-000000002662'
    const B = '00000000-0000-4000-8000-000000002663'
    for (const u of [A, B]) {
      await pool.query('DELETE FROM users WHERE id = $1', [u])
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [u, `clear-2660-${u}@example.com`, TZ])
      await pool.query(`INSERT INTO oura_daily_derived (user_id, day, sleep_score) VALUES ($1,$2,70)`, [u, TODAY])
    }
    try {
      asUser(A)
      const { id } = await manual('POST', { sleepStart: BED, sleepEnd: WAKE })
      await manual('DELETE', { id })
      const { rows } = await pool.query(`SELECT user_id, sleep_score FROM oura_daily_derived WHERE user_id = ANY($1) ORDER BY user_id`, [[A, B]])
      expect(rows).toEqual([{ user_id: A, sleep_score: null }, { user_id: B, sleep_score: 70 }])
    } finally {
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]])
    }
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
    const storedRow = async () => (await pool.query(
      `SELECT sleep_score, sleep_contributors FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [WITH_RING, TODAY])).rows[0]
    const kept = await storedRow()
    expect(kept.sleep_score).not.toBeNull()
    await manual('DELETE', { id })
    expect(await readiness()).toBe(before)
    // The ring's own night remains on the date, so the stored score is not cleared (issue 2660).
    expect(await storedRow()).toEqual(kept)
  })
})
