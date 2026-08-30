// BF-53 — every pending weigh-in button returned 400 before the guard written for it could run.
//
// `scale_raw_samples.id` is a `bigserial`, and both routes ran `invalidUuidResponse` over it. A
// decimal id can never match a UUID regex, so **every** press of "Not me" or "Yes, that's me" was
// `400 Invalid id`, and the whole pending weigh-in triage was dead in production: a reading that was
// not the owner's could not be dismissed, and one that was could not be confirmed into
// `body_metrics`. The correct `Number.isInteger` check sat unreachable on the next line, which is the
// tell that someone knew the key was numeric and the sweep applied the UUID guard over the top.
//
// The owner reported it as *"the 'not me' button for weigh in's doesnt actually remove it or do
// anything"* — a no-op, not an error — because the client was `if (res.ok)` with no else.
//
// **These tests exist because nothing here could have been exercised with a realistic id.** A test
// posting a UUID would have passed the guard and 404'd, and read as correct.
//
// Runs against the real repository and a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bf53'
const OTHER = '00000000-0000-4000-8000-00000000bf5e'

const authUser = { current: USER }
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: authUser.current, timezone: 'Australia/Brisbane' } }) }))

const post = async (mod: string, id: string) => {
  const { POST } = await import(mod) as { POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }
  return POST(
    new NextRequest(`http://x/api/scale-ble/pending/${id}/x`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  )
}
const dismiss = (id: string) => post('@/app/api/scale-ble/pending/[id]/dismiss/route', id)
const confirm = (id: string) => post('@/app/api/scale-ble/pending/[id]/confirm/route', id)

describe.skipIf(!canRun)('pending weigh-in confirm/dismiss take a numeric id (BF-53)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, height_cm, sex, date_of_birth)
         VALUES ($1, $2, 'x', 'Australia/Brisbane', 175, 'male', '1990-01-01')
         ON CONFLICT (id) DO NOTHING`, [id, `bf53-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    authUser.current = USER
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [id])
    }
  })

  /** A staged reading, exactly as the anomaly gate leaves one. Returns its real bigserial id. */
  const stage = async (owner = USER): Promise<number> => {
    const { rows } = await pool.query(
      `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, decoded, status)
       VALUES ($1, now() - interval '2 hours', 'aabb', $2::jsonb, 'pending') RETURNING id`,
      [owner, JSON.stringify({ weightKg: 74.2, impedanceOhmsA: 510, impedanceOhmsB: 520 })])
    return Number(rows[0].id)
  }

  it('dismisses a real reading — the press the owner reported as doing nothing', async () => {
    const id = await stage()
    const res = await dismiss(String(id))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'dismissed' })
    const { rows } = await pool.query(`SELECT status FROM scale_raw_samples WHERE id = $1`, [id])
    expect(rows[0].status).toBe('dismissed')
  })

  it('confirms a real reading, and the weight reaches body_metrics', async () => {
    const id = await stage()
    const res = await confirm(String(id))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'confirmed', weightKg: 74.2 })
    // The half the owner cannot see from the button: confirming is what writes the weigh-in.
    const { rows } = await pool.query(
      `SELECT weight_kg FROM body_metrics WHERE user_id = $1`, [USER])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].weight_kg)).toBeCloseTo(74.2, 1)
  })

  // The exact shape that shipped. A UUID here would have passed the old guard and 404'd, which is
  // why the existing coverage could not have caught this.
  it('no longer rejects the id format the route actually receives', async () => {
    const id = await stage()
    // What `invalidUuidResponse` did to it, reproduced: a decimal id fails a UUID regex.
    const { isUuid } = await import('@trainingai/shared/validation/uuid')
    expect(isUuid(String(id))).toBe(false)

    expect((await dismiss(String(id))).status).not.toBe(400)
  })

  describe('a genuinely bad id is still refused', () => {
    it.each(['not-a-number', '', '1.5', '-3', '1e3', '0x10', ' 41 ', '9'.repeat(30)])(
      'refuses %j with 400', async (bad) => {
        expect((await dismiss(bad)).status).toBe(400)
        expect((await confirm(bad)).status).toBe(400)
      })

    // `0` parses as an integer and would have passed a bare `Number.isInteger`, but a bigserial
    // starts at 1 — so it is a malformed id, not a missing row.
    it('refuses 0, which no bigserial ever is', async () => {
      expect((await dismiss('0')).status).toBe(400)
    })

    it('404s a well-formed id that is not there', async () => {
      expect((await dismiss('999999999')).status).toBe(404)
    })
  })

  // The guard being wrong hid this: every request 400'd before ownership was ever consulted.
  it("refuses another user's reading with 404, not by acting on it", async () => {
    const id = await stage(OTHER)
    expect((await dismiss(String(id))).status).toBe(404)
    expect((await confirm(String(id))).status).toBe(404)
    const { rows } = await pool.query(`SELECT status FROM scale_raw_samples WHERE id = $1`, [id])
    expect(rows[0].status).toBe('pending')
  })

  it('only acts on a PENDING reading', async () => {
    const id = await stage()
    await pool.query(`UPDATE scale_raw_samples SET status = 'confirmed' WHERE id = $1`, [id])
    expect((await dismiss(String(id))).status).toBe(404)
  })

  it('is 401 with no session, before the id is looked at', async () => {
    authUser.current = ''
    expect((await dismiss('1')).status).toBe(401)
    expect((await confirm('1')).status).toBe(401)
  })
})
