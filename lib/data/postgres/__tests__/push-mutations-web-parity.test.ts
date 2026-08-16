// Integration suite: for mood_logs, session_rpe, day_checkins, and food_logs,
// push a mutation through repo.pushMutations and the same payload through the
// web route handler, and assert both (a) apply identical defaults/clamps and
// (b) reject the same invalid payloads. Regression-proofs the documented
// pushMutations/web-route drift class (#47/#74/#82).
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else
// (CI's "Tests" job has no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const TEST_USER_ID = '00000000-0000-4000-8000-00000000f00d'

function jsonReq(url: string, body: object) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe.skipIf(!canRun)('pushMutations <-> web route parity', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let mealTypeId: string
  let foodItemId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `parity-test-${TEST_USER_ID}@example.com`],
    )
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name) VALUES ($1, 'Parity Test Meal') RETURNING id`,
      [TEST_USER_ID],
    )
    mealTypeId = mt.rows[0].id
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1, 'Parity Test Food', 100, 'manual') RETURNING id`,
      [TEST_USER_ID],
    )
    foodItemId = fi.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('mood_logs: both paths default sleepQuality to "ok" when omitted', async () => {
    const { POST } = await import('@/app/api/mood/route')
    const res = await POST(jsonReq('http://localhost/api/mood', { energyLevel: 'good', bodyState: [], soreMuscles: [] }) as never)
    expect(res.status).toBe(200)
    const webRow = await pool.query(`SELECT sleep_quality FROM mood_logs WHERE user_id = $1`, [TEST_USER_ID])
    expect(webRow.rows[0].sleep_quality).toBe('ok')
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [TEST_USER_ID])

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-mood-1', domain: 'mood_logs', date: '2026-01-01',
      payload: { energyLevel: 'good', bodyState: [], soreMuscles: [] },
    }])
    expect(result.processed).toBe(1)
    const pushRow = await pool.query(`SELECT sleep_quality FROM mood_logs WHERE user_id = $1`, [TEST_USER_ID])
    expect(pushRow.rows[0].sleep_quality).toBe('ok')
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('mood_logs: both paths reject an energyLevel outside the enum (Q-131)', async () => {
    // The push branch used to cast straight through, so an arbitrary string reached the NOT NULL
    // energy_level column and every readiness/energy surface rendered it as a real check-in.
    const { POST } = await import('@/app/api/mood/route')
    const res = await POST(jsonReq('http://localhost/api/mood', { energyLevel: 'ecstatic' }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-mood-2', domain: 'mood_logs', date: '2026-01-01',
      payload: { energyLevel: 'ecstatic' },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/mood/i)
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM mood_logs WHERE user_id = $1`, [TEST_USER_ID])
    expect(rows[0].n).toBe(0)
  })

  it('food_items: both paths keep barcode and default region to AU (Q-131)', async () => {
    // The push branch dropped barcode entirely and hardcoded region to '' — the same item saved
    // offline lost the barcode a later rescan would match on.
    const id = crypto.randomUUID()
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-item-1', domain: 'food_items', date: '2026-01-01',
      payload: { id, name: 'Parity Barcode Food', calories: 120, barcode: '9300601234567' },
    }])
    expect(result.processed).toBe(1)
    const { rows } = await pool.query(
      `SELECT barcode, region, serving_size_g FROM food_items WHERE id = $1`, [id])
    expect(rows[0].barcode).toBe('9300601234567')
    expect(rows[0].region).toBe('AU')
    // The web route defaults an omitted serving size to 100g; the push branch used 0, which
    // collapses every per-serving calculation downstream.
    expect(Number(rows[0].serving_size_g)).toBe(100)
    await pool.query(`DELETE FROM food_items WHERE id = $1`, [id])
  })

  it('day_checkins: both paths reject an invalid phase value', async () => {
    const { POST } = await import('@/app/api/day-checkin/route')
    const res = await POST(jsonReq('http://localhost/api/day-checkin', { phase: 'noon' }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-checkin-1', domain: 'day_checkins', date: '2026-01-01',
      payload: { phase: 'noon' },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/phase/i)
  })

  it('day_checkins: both paths default phase to "evening" when omitted', async () => {
    const { POST } = await import('@/app/api/day-checkin/route')
    const res = await POST(jsonReq('http://localhost/api/day-checkin', { date: '2026-01-02' }) as never)
    expect(res.status).toBe(201)
    const webRow = await pool.query(`SELECT phase FROM day_checkins WHERE user_id = $1 AND log_date = '2026-01-02'`, [TEST_USER_ID])
    expect(webRow.rows[0].phase).toBe('evening')

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-checkin-2', domain: 'day_checkins', date: '2026-01-03',
      payload: {},
    }])
    expect(result.processed).toBe(1)
    const pushRow = await pool.query(`SELECT phase FROM day_checkins WHERE user_id = $1 AND log_date = '2026-01-03'`, [TEST_USER_ID])
    expect(pushRow.rows[0].phase).toBe('evening')

    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('food_logs: both paths reject a quantityMultiplier outside [0.01, 100]', async () => {
    const { POST } = await import('@/app/api/nutrition/food-logs/route')
    const res = await POST(jsonReq('http://localhost/api/nutrition/food-logs', {
      date: '2026-01-01', mealTypeId, foodItemId, quantityMultiplier: 500,
    }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-food-1', domain: 'food_logs', date: '2026-01-01',
      payload: { id: crypto.randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 500 },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/quantityMultiplier/i)
  })

  it('food_logs: both paths default quantityMultiplier to 1 when omitted', async () => {
    const { POST } = await import('@/app/api/nutrition/food-logs/route')
    const res = await POST(jsonReq('http://localhost/api/nutrition/food-logs', { date: '2026-01-04', mealTypeId, foodItemId }) as never)
    expect(res.status).toBe(201)
    const webRow = await pool.query(`SELECT quantity_multiplier FROM food_logs WHERE user_id = $1 AND date = '2026-01-04'`, [TEST_USER_ID])
    expect(Number(webRow.rows[0].quantity_multiplier)).toBe(1)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-food-2', domain: 'food_logs', date: '2026-01-05',
      payload: { id: crypto.randomUUID(), mealTypeId, foodItemId },
    }])
    expect(result.processed).toBe(1)
    const pushRow = await pool.query(`SELECT quantity_multiplier FROM food_logs WHERE user_id = $1 AND date = '2026-01-05'`, [TEST_USER_ID])
    expect(Number(pushRow.rows[0].quantity_multiplier)).toBe(1)

    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('food_logs: push delete and push qm-edit both bump updated_at', async () => {
    const id = crypto.randomUUID()
    await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-food-3', domain: 'food_logs', date: '2026-01-13',
      payload: { id, mealTypeId, foodItemId, quantityMultiplier: 1 },
    }])
    await pool.query(`UPDATE food_logs SET updated_at = '2020-01-01' WHERE id = $1`, [id])

    const edit = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-food-4', domain: 'food_logs', date: '2026-01-13',
      payload: { id, mealTypeId, foodItemId, quantityMultiplier: 2 },
    }])
    expect(edit.processed).toBe(1)
    let row = await pool.query(`SELECT quantity_multiplier, updated_at FROM food_logs WHERE id = $1`, [id])
    expect(Number(row.rows[0].quantity_multiplier)).toBe(2)
    expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(`UPDATE food_logs SET updated_at = '2020-01-01' WHERE id = $1`, [id])
    const del = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-food-5', domain: 'food_logs', date: '2026-01-13',
      payload: { id, deleted: true },
    }])
    expect(del.processed).toBe(1)
    row = await pool.query(`SELECT deleted_at, updated_at FROM food_logs WHERE id = $1`, [id])
    expect(row.rows[0].deleted_at).not.toBeNull()
    expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(`DELETE FROM food_logs WHERE id = $1`, [id])
  })

  it('body_metrics: web route rejects an out-of-range waistCm; pushMutations drops just that field', async () => {
    // Unlike day_checkins/food_logs, the pushMutations body_metrics branch has never
    // hard-rejected a whole mutation over one bad field (a batched write shouldn't lose
    // weightKg/calories over one bad measurement) — so parity here means "the bad value
    // never lands," not "identical HTTP status," matching the branch's existing design.
    const { POST } = await import('@/app/api/body-metadata/route')
    const res = await POST(jsonReq('http://localhost/api/body-metadata', { localDate: '2026-01-06', waistCm: 500 }) as never)
    expect(res.status).toBe(400)
    const webRow = await pool.query(`SELECT waist_cm FROM body_metrics WHERE user_id = $1 AND date = '2026-01-06'`, [TEST_USER_ID])
    expect(webRow.rows.length).toBe(0)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-body-1', domain: 'body_metrics', date: '2026-01-06',
      payload: { waistCm: 500, weightKg: 80 },
    }])
    expect(result.processed).toBe(1)
    const pushRow = await pool.query(`SELECT waist_cm, weight_kg FROM body_metrics WHERE user_id = $1 AND date = '2026-01-06'`, [TEST_USER_ID])
    expect(pushRow.rows[0].waist_cm).toBeNull()
    expect(Number(pushRow.rows[0].weight_kg)).toBe(80)

    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('session_rpe: both paths reject an out-of-range sessionRpe', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Parity Test', now()) RETURNING id`,
      [TEST_USER_ID],
    )
    const workoutSessionId = ws.rows[0].id

    const { POST } = await import('@/app/api/workout-sessions/rpe/route')
    const res = await POST(jsonReq('http://localhost/api/workout-sessions/rpe', { workoutSessionId, sessionRpe: 99 }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-rpe-1', domain: 'session_rpe', date: '2026-01-01',
      payload: { workoutSessionId, sessionRpe: 99 },
    }])
    expect(result.processed).toBe(0)

    await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [workoutSessionId])
  })

  it('supplement_logs: push unlog + re-log both bump updated_at (sync-delta visibility)', async () => {
    const sup = await pool.query(
      `INSERT INTO supplements (user_id, name) VALUES ($1, 'Parity Creatine') RETURNING id`,
      [TEST_USER_ID],
    )
    const supplementId = sup.rows[0].id

    await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-log-1', domain: 'supplement_logs', date: '2026-01-10',
      payload: { supplementId, logDate: '2026-01-10' },
    }])
    const created = await pool.query(
      `SELECT updated_at FROM supplement_logs WHERE supplement_id = $1 AND log_date = '2026-01-10'`,
      [supplementId],
    )
    expect(created.rows.length).toBe(1)

    await pool.query(
      `UPDATE supplement_logs SET updated_at = '2020-01-01' WHERE supplement_id = $1`, [supplementId],
    )
    const unlog = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-log-2', domain: 'supplement_logs', date: '2026-01-10',
      payload: { supplementId, logDate: '2026-01-10', deleted: true },
    }])
    expect(unlog.processed).toBe(1)
    const afterUnlog = await pool.query(
      `SELECT deleted_at, updated_at FROM supplement_logs WHERE supplement_id = $1`, [supplementId],
    )
    expect(afterUnlog.rows[0].deleted_at).not.toBeNull()
    expect(new Date(afterUnlog.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(
      `UPDATE supplement_logs SET updated_at = '2020-01-01' WHERE supplement_id = $1`, [supplementId],
    )
    const relog = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-log-3', domain: 'supplement_logs', date: '2026-01-10',
      payload: { supplementId, logDate: '2026-01-10' },
    }])
    expect(relog.processed).toBe(1)
    const afterRelog = await pool.query(
      `SELECT deleted_at, updated_at FROM supplement_logs WHERE supplement_id = $1`, [supplementId],
    )
    expect(afterRelog.rows[0].deleted_at).toBeNull()
    expect(new Date(afterRelog.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(`DELETE FROM supplements WHERE id = $1`, [supplementId])
  })

  it('supplement_logs: push rejects a supplement the user does not own', async () => {
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-log-4', domain: 'supplement_logs', date: '2026-01-10',
      payload: { supplementId: crypto.randomUUID(), logDate: '2026-01-10' },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors.length).toBe(1)
  })

  it('supplements: push delete matches web deleteSupplement (active=false, deleted_at, updated_at)', async () => {
    const id = crypto.randomUUID()
    await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-1', domain: 'supplements', date: '2026-01-11',
      payload: { id, name: 'Parity Mag', sortOrder: 0, active: true },
    }])
    await pool.query(`UPDATE supplements SET updated_at = '2020-01-01' WHERE id = $1`, [id])

    const del = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-2', domain: 'supplements', date: '2026-01-11',
      payload: { id, deleted: true },
    }])
    expect(del.processed).toBe(1)
    const row = await pool.query(
      `SELECT active, deleted_at, updated_at FROM supplements WHERE id = $1`, [id],
    )
    expect(row.rows[0].active).toBe(false)
    expect(row.rows[0].deleted_at).not.toBeNull()
    expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(`DELETE FROM supplements WHERE id = $1`, [id])
  })

  it('injuries: push resolvedDate patch does not clobber notes and bumps updated_at', async () => {
    const id = crypto.randomUUID()
    await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-inj-1', domain: 'injuries', date: '2026-01-12',
      payload: { id, muscleName: 'Hamstrings', severity: 'mild', notes: 'tweaked on RDLs', startedDate: '2026-01-12' },
    }])
    await pool.query(`UPDATE injuries SET updated_at = '2020-01-01' WHERE id = $1`, [id])

    const patch = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-inj-2', domain: 'injuries', date: '2026-01-12',
      payload: { id, resolvedDate: '2026-01-20' },
    }])
    expect(patch.processed).toBe(1)
    const row = await pool.query(
      `SELECT notes, resolved_date::text, updated_at FROM injuries WHERE id = $1`, [id],
    )
    expect(row.rows[0].notes).toBe('tweaked on RDLs')
    expect(row.rows[0].resolved_date).toBe('2026-01-20')
    expect(new Date(row.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)

    await pool.query(`DELETE FROM injuries WHERE id = $1`, [id])
  })

  it('injuries: web PATCH with only resolvedDate must not null-clobber notes', async () => {
    const created = await repo.createInjury(TEST_USER_ID, {
      muscleName: 'Calves', severity: 'mild', notes: 'web parity note',
      startedDate: '2026-01-12', resolvedDate: null,
    })
    const updated = await repo.updateInjury(created.id, TEST_USER_ID, { resolvedDate: '2026-01-21' })
    expect(updated.notes).toBe('web parity note')
    expect(updated.resolvedDate).toBe('2026-01-21')
    await pool.query(`DELETE FROM injuries WHERE id = $1`, [created.id])
  })

  it('activity_logs: push preserves caloriesBurned (regression: inline branch dropped it)', async () => {
    const id = crypto.randomUUID()
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-act-1', domain: 'activity_logs', date: '2026-01-14',
      payload: { id, activityType: 'run', title: 'Parity Run', startTime: '06:30', durationMin: 30, caloriesBurned: 320 },
    }])
    expect(result.processed).toBe(1)
    const row = await pool.query(`SELECT calories_burned FROM activity_logs WHERE id = $1`, [id])
    expect(Number(row.rows[0].calories_burned)).toBe(320)
    await pool.query(`DELETE FROM activity_logs WHERE id = $1`, [id])
  })

  it('activity_logs: both paths reject a title-less payload instead of storing "undefined" (SYNC-P3)', async () => {
    const { POST } = await import('@/app/api/activity-logs/route')
    const res = await POST(jsonReq('http://localhost/api/activity-logs', {
      date: '2026-01-15', activityType: 'run',
    }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-act-2', domain: 'activity_logs', date: '2026-01-15',
      payload: { id: crypto.randomUUID(), activityType: 'run' },
    }])
    expect(result.processed).toBe(0)
    const row = await pool.query(`SELECT id FROM activity_logs WHERE user_id = $1 AND date = '2026-01-15'`, [TEST_USER_ID])
    expect(row.rows.length).toBe(0)
  })

  it('activity_logs: push derives endTime from startTime + durationMin, matching the web route (SYNC-P3)', async () => {
    const id = crypto.randomUUID()
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-act-3', domain: 'activity_logs', date: '2026-01-16',
      payload: { id, activityType: 'run', title: 'Endtime Test', startTime: '06:00', durationMin: 45 },
    }])
    expect(result.processed).toBe(1)
    const row = await pool.query(`SELECT end_time FROM activity_logs WHERE id = $1`, [id])
    expect(row.rows[0].end_time.slice(0, 5)).toBe('06:45')
    await pool.query(`DELETE FROM activity_logs WHERE id = $1`, [id])
  })

  it('injuries: both paths reject an invalid severity value (SYNC-P4)', async () => {
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-inj-3', domain: 'injuries', date: '2026-01-17',
      payload: { id: crypto.randomUUID(), muscleName: 'Quads', severity: 'catastrophic', startedDate: '2026-01-17' },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/injuries/i)
  })

  it('supplements: push rejects a missing name instead of storing "undefined" (SYNC-P4)', async () => {
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-sup-3', domain: 'supplements', date: '2026-01-18',
      payload: { id: crypto.randomUUID(), sortOrder: 0, active: true },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/name/i)
  })

  it('day_checkins: both paths reject a journal string over 2000 chars (SYNC-P4)', async () => {
    const longJournal = 'x'.repeat(2001)
    const { POST } = await import('@/app/api/day-checkin/route')
    const res = await POST(jsonReq('http://localhost/api/day-checkin', { date: '2026-01-19', journal: longJournal }) as never)
    expect(res.status).toBe(400)

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-checkin-3', domain: 'day_checkins', date: '2026-01-19',
      payload: { journal: longJournal },
    }])
    expect(result.processed).toBe(0)
    expect(result.errors[0]?.error).toMatch(/journal/i)
  })

  it('water: web POST /api/water-log and pushMutations waterMlDelta both increment rather than clobber (SYNC-P7)', async () => {
    const { POST } = await import('@/app/api/water-log/route')
    const res = await POST(jsonReq('http://localhost/api/water-log', { ml: 250 }) as never)
    expect(res.status).toBe(200)
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    const today = todayInTz('Australia/Brisbane')

    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-water-1', domain: 'body_metrics', date: today,
      payload: { waterMlDelta: 250 },
    }])
    expect(result.processed).toBe(1)
    const row = await pool.query(`SELECT water_ml FROM body_metrics WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, today])
    expect(Number(row.rows[0].water_ml)).toBe(500)
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, today])
  })

  it('pushMutations reports an unrecognized domain as a retryable error, not a silent drop (SYNC-Q1)', async () => {
    // Simulates a newer client sending a domain this server version doesn't
    // recognize yet (mid-deploy) — MutationDomain intentionally doesn't include
    // this value, so the cast documents the scenario being exercised.
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-unknown-1', domain: 'not_a_real_domain' as never, date: '2026-01-20',
      payload: {},
    }])
    expect(result.processed).toBe(0)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]?.id).toBe('mut-unknown-1')
    expect(result.errors[0]?.error).toMatch(/unsupported domain/i)
  })
})
