/**
 * RV-55 and RV-56 — two ways a client error was becoming a server fault.
 *
 * Both write an `error_events` row and answer 500 with an empty body, which is the Q-496 shape: the
 * caller learns nothing and the fault table fills with input the route should simply have refused.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000556'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('RV-55/56 — route input that used to reach the driver', () => {
  let pool: import('pg').Pool
  let supplementId: string

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'rv55-56@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM supplement_vials WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM supplement_vials WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
    const { rows } = await pool.query(
      `INSERT INTO supplements (user_id, name, dose, unit) VALUES ($1, 'RV55 Test', '1', 'mg') RETURNING id`,
      [USER])
    supplementId = rows[0].id
  })

  const postVial = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/supplements/[id]/vials/route')
    return POST(
      new Request(`http://localhost/api/supplements/${supplementId}/vials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ id: supplementId }) },
    )
  }
  const VIAL = { strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-10' }

  const postBedtime = async (body: unknown) => {
    const { POST } = await import('@/app/api/sleep/manual-bedtime/route')
    return POST(new Request('http://localhost/api/sleep/manual-bedtime', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }

  // ── RV-55 ────────────────────────────────────────────────────────────────────

  /**
   * THE case. `id` used to be accepted and inserted unguarded, so a duplicate UUID raised 23505 and
   * answered 500. The field is gone, and the schema is `.strict()`, so an unknown key is now a 400 —
   * which is the outcome that removes the existence oracle rather than renaming it.
   */
  it('refuses a client-supplied vial id instead of inserting it', async () => {
    const res = await postVial({ ...VIAL, id: '11111111-1111-4111-8111-111111111111' })
    expect(res.status).toBe(400)

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM supplement_vials WHERE user_id = $1`, [USER])
    expect(rows[0].n).toBe(0)
  })

  /**
   * The deliberately equivalent control: the same request without `id` must still work. Without it,
   * a change that broke vial creation outright would pass the case above.
   */
  it('still creates a vial when no id is supplied', async () => {
    expect((await postVial(VIAL)).status).toBe(201)

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM supplement_vials WHERE user_id = $1`, [USER])
    expect(rows[0].n).toBe(1)
  })

  // ── RV-56 ────────────────────────────────────────────────────────────────────

  /**
   * A date-SHAPED string that is not a real day. The separator regex passed these; only
   * `isCalendarDate` refuses them. `2026-02-31` is the sharper of the two because it is a real month
   * with a plausible day — `2026-13-45` would be caught by almost any hand-rolled guard.
   */
  it.each(['2026-02-31', '2026-13-45', '0000-00-00'])(
    'answers 400 rather than 500 for openedOn %s', async (openedOn) => {
      expect((await postVial({ ...VIAL, openedOn })).status).toBe(400)
    })

  /**
   * The body key is `at`, not `sleepStart`, and the schema is `.strict()`. The first draft of this
   * case sent `sleepStart` and therefore got its 400 from the unknown key — it passed against the
   * UNFIXED route and proved nothing. A test that is right for the wrong reason is worse than a
   * missing one, because it reads as coverage.
   */
  it.each(['2026-02-31', '2026-13-45'])(
    'manual-bedtime answers 400 rather than 500 for date %s', async (date) => {
      const res = await postBedtime({ date, at: '2026-09-09T13:00:00.000Z' })
      expect(res.status).toBe(400)
    })

  /**
   * The control that proves the case above is about the DATE: a real day with the same body reaches
   * the handler, which 404s because no sleep session was seeded. 404 rather than 400 is the whole
   * point — it means validation passed and the route ran.
   */
  it('manual-bedtime passes validation for a real day and 404s on the missing night', async () => {
    const res = await postBedtime({ date: '2026-09-10', at: '2026-09-09T13:00:00.000Z' })
    expect(res.status).toBe(404)
  })

  /**
   * The control for the date half, and the reason the regex stays: a real day must still be
   * accepted, in BOTH separator forms, because the client's `localDateString()` emits slashes.
   */
  it.each(['2026-09-10', '2026/09/10'])('still accepts the real day %s', async (openedOn) => {
    expect((await postVial({ ...VIAL, openedOn })).status).toBe(201)
  })
})
