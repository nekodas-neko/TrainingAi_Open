// #2457: the set_hr_stats.hrr1_bpm backfill. What must hold: a dry run writes nothing and predicts
// the real run exactly; a real run fills hrr1_bpm from dense HR, clears a ring-era verdict to null,
// leaves another user's rows alone, and is idempotent; the raw HR series is never touched.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b2457'
const OTHER = '00000000-0000-4000-8000-0000000b2458'
const WS = '00000000-0000-4000-8000-0000000b2460'
const WS_OTHER = '00000000-0000-4000-8000-0000000b2461'
const EL = '00000000-0000-4000-8000-0000000b2462'
const EL_OTHER = '00000000-0000-4000-8000-0000000b2463'
const SL_STRAP = '00000000-0000-4000-8000-0000000b2464'
const SL_RING = '00000000-0000-4000-8000-0000000b2465'
const SL_NONE = '00000000-0000-4000-8000-0000000b2466'
const SL_OTHER = '00000000-0000-4000-8000-0000000b2467'
const TZ = 'Australia/Brisbane'

const authUser = { id: USER, timezone: TZ, isAdmin: true }
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: authUser })) }))

describe.skipIf(!canRun)('backfill-set-hrr1 (#2457)', () => {
  let pool: import('pg').Pool
  // Local midday two days back, so the fixture never straddles a date boundary.
  const strapEnd = new Date(Date.now() - 2 * 86_400_000)
  strapEnd.setUTCHours(2, 0, 0, 0)
  const ringEnd = new Date(strapEnd.getTime() + 10 * 60_000)
  const noneEnd = new Date(strapEnd.getTime() + 20 * 60_000)

  const call = async (qs: string) => {
    const { POST } = await import('../route')
    const res = await POST(new NextRequest(`http://localhost/api/admin/backfill-set-hrr1?${qs}`, { method: 'POST' }))
    return { status: res.status, body: await res.json() }
  }
  const stored = async (id: string) => (await pool.query(
    `SELECT hrr1_bpm, rest_adequate FROM set_hr_stats WHERE set_log_id = $1`, [id])).rows[0]
  const hrCount = async () => Number((await pool.query(
    `SELECT count(*) FROM oura_heartrate WHERE user_id = ANY($1::uuid[])`, [[USER, OTHER]])).rows[0].count)

  const cleanup = async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1::uuid[])`, [[USER, OTHER]])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1::uuid[])`, [[USER, OTHER]])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const [id, admin] of [[USER, true], [OTHER, false]] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES ($1, $2, 'x', $3, $4)
         ON CONFLICT (id) DO UPDATE SET is_admin = $4`,
        [id, `hrr1-${id}@example.com`, TZ, admin])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER, OTHER]])
  })

  beforeEach(async () => {
    await cleanup()
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%backfill-set-hrr1%'`)

    for (const [ws, el, user] of [[WS, EL, USER], [WS_OTHER, EL_OTHER, OTHER]]) {
      await pool.query(
        `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at, phase_type)
         VALUES ($1, $2, 'Push', $3, $4, 'peak')`,
        [ws, user, new Date(strapEnd.getTime() - 600_000), new Date(noneEnd.getTime() + 600_000)])
      await pool.query(
        `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1, $2, 'Bench', $3)`,
        [el, ws, strapEnd])
    }
    const sets: [string, string, number][] = [[SL_STRAP, EL, 1], [SL_RING, EL, 2], [SL_NONE, EL, 3], [SL_OTHER, EL_OTHER, 1]]
    for (const [id, el, n] of sets) {
      await pool.query(
        `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps) VALUES ($1, $2, $3, 100, 5)`, [id, el, n])
    }
    // Stored rows as the older nearest-reading rule left them: every one carries a verdict.
    const rows: [string, string, string, Date, boolean][] = [
      [SL_STRAP, USER, WS, strapEnd, false],
      [SL_RING, USER, WS, ringEnd, true],
      [SL_NONE, USER, WS, noneEnd, true],
      [SL_OTHER, OTHER, WS_OTHER, strapEnd, true],
    ]
    for (const [id, user, ws, at, verdict] of rows) {
      await pool.query(
        `INSERT INTO set_hr_stats (set_log_id, user_id, workout_session_id, exercise_name, set_number, logged_at, rest_adequate, readings_count)
         VALUES ($1, $2, $3, 'Bench', 1, $4, $5, 10)`, [id, user, ws, at, verdict])
    }
    // Strap at 1 Hz over the minute after SL_STRAP's end: 150 → 130, a 20 bpm recovery. The other
    // user has the same series, so a cross-user read would give their row a value too.
    const values: string[] = []
    const params: unknown[] = []
    for (const user of [USER, OTHER]) {
      for (let k = 0; k <= 60; k++) {
        params.push(user, new Date(strapEnd.getTime() + k * 1000), 150 - Math.round(k / 3))
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length}, 'chest_strap')`)
      }
    }
    // The ring around SL_RING: three points, each anchor hit exactly, too sparse to measure.
    for (const k of [0, 30, 60]) {
      params.push(USER, new Date(ringEnd.getTime() + k * 1000), 110 - k / 10)
      values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length}, 'ble')`)
    }
    await pool.query(`INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${values.join(', ')}`, params)
  })

  it('a dry run predicts the change and writes nothing', async () => {
    const before = await hrCount()
    const { status, body } = await call('')
    expect(status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(body.summary).toMatchObject({
      rowsExamined: 3, sessionsExamined: 1, rowsChanged: 3, gainedHrr1: 1, rowsWithHrr1After: 1, daysChanged: 1, written: 0,
      verdictTransitions: { 'inadequate -> adequate': 1, 'adequate -> none': 2 },
    })
    expect(await stored(SL_STRAP)).toEqual({ hrr1_bpm: null, rest_adequate: false })
    expect(await stored(SL_RING)).toEqual({ hrr1_bpm: null, rest_adequate: true })
    expect(await hrCount()).toBe(before)
  })

  it('a real run writes exactly what the dry run predicted, only for the caller, and is idempotent', async () => {
    const dry = (await call('dryRun=true')).body
    const before = await hrCount()
    const { body } = await call('dryRun=false')
    expect(body.summary.written).toBe(dry.summary.rowsChanged)

    expect(await stored(SL_STRAP)).toEqual({ hrr1_bpm: 20, rest_adequate: true })
    expect(await stored(SL_RING)).toEqual({ hrr1_bpm: null, rest_adequate: null })
    expect(await stored(SL_NONE)).toEqual({ hrr1_bpm: null, rest_adequate: null })
    expect(await stored(SL_OTHER)).toEqual({ hrr1_bpm: null, rest_adequate: true })
    expect(await hrCount()).toBe(before)

    const again = (await call('dryRun=false')).body
    expect(again.summary).toMatchObject({ rowsChanged: 0, written: 0, rowsWithHrr1After: 1 })
  })

  it('refuses a dryRun value it does not understand rather than guessing', async () => {
    const { status } = await call('dryRun=no')
    expect(status).toBe(400)
    expect(await stored(SL_RING)).toEqual({ hrr1_bpm: null, rest_adequate: true })
  })

  it('is admin-only', async () => {
    authUser.isAdmin = false
    await pool.query(`UPDATE users SET is_admin = false WHERE id = $1`, [USER])
    try {
      const { status } = await call('dryRun=false')
      expect(status).toBe(403)
      expect(await stored(SL_RING)).toEqual({ hrr1_bpm: null, rest_adequate: true })
    } finally {
      authUser.isAdmin = true
      await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [USER])
    }
  })
})
