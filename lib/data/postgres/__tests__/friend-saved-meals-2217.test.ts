// #2217 — `GET /api/friends/[id]/saved-meals`, against real rows.
//
// The one route where a user's *meals* reach another user, so the boundary is the whole feature:
// the friendship must be accepted AND the friend must have opted in, and every refusal must be the
// same response. Mocks cannot see the SQL that decides this, hence real rows.
//
//   · no friendship / pending / someone else's friendship / opted out / opt-in absent → one 404 body;
//   · opting out again closes it; a malformed id is a 400 (UUID syntax is public), not a 404;
//   · the route's totals equal the author's own meal totals ("totals are sacred"), including past
//     the 12 ingredients the label path would roll up;
//   · a deleted meal is absent, and only name/servings/ingredients/macros leave the server.
//
// Runs only against a real Postgres. CI's "Tests" job sets DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const ME = '00000000-0000-4000-8000-000000002217'
const FRIEND = '00000000-0000-4000-8000-000000002218'
const PENDING = '00000000-0000-4000-8000-000000002219'
const OTHER_A = '00000000-0000-4000-8000-00000000221a'
const OTHER_B = '00000000-0000-4000-8000-00000000221b'
const NO_FRIENDSHIP = '00000000-0000-4000-8000-00000000221f'
const users = [ME, FRIEND, PENDING, OTHER_A, OTHER_B]

let sessionUser: { id: string } | null = { id: ME }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('a friend\'s saved-meal library (#2217)', () => {
  let pool: import('pg').Pool
  let GET: typeof import('@/app/api/friends/[id]/saved-meals/route').GET
  let repo: import('@/lib/data/repository').WorkoutRepository
  let resetLimiter: () => void
  let friendship: string, pendingFriendship: string, strangersFriendship: string

  const call = async (id: string) => {
    const res = await GET(new Request(`http://x/api/friends/${id}/saved-meals`), { params: Promise.resolve({ id }) })
    return { status: res.status, body: await res.json(), cache: res.headers.get('Cache-Control') }
  }
  const setShare = (userId: string, value: unknown) => pool.query(
    `UPDATE users SET preferences = $2::jsonb WHERE id = $1`,
    [userId, JSON.stringify(value === undefined ? {} : { shareMealLibrary: value })])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    ;({ GET } = await import('@/app/api/friends/[id]/saved-meals/route'))
    ;({ _resetRateLimitL1: resetLimiter } = await import('@/lib/rate-limit'))
    pool = getPool()
    repo = new PostgresWorkoutRepository()
    for (const id of users) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `fsm-${id}@example.com`])
    }
    const mk = async (a: string, b: string, status: string) => (await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,$3) RETURNING id`,
      [a, b, status])).rows[0].id as string
    // Friend is the REQUESTER, me the addressee — the route has to resolve either direction.
    friendship = await mk(FRIEND, ME, 'accepted')
    pendingFriendship = await mk(PENDING, ME, 'pending')
    strangersFriendship = await mk(OTHER_A, OTHER_B, 'accepted')
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM meal_types WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM saved_meals WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM friendships WHERE requester_id = ANY($1) OR addressee_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users])
  })

  beforeEach(async () => {
    sessionUser = { id: ME }
    resetLimiter()
    await pool.query(`DELETE FROM food_logs WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM meal_types WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM saved_meals WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [users])
    for (const id of users) await setShare(id, undefined)
  })

  /** A meal of `n` distinct ingredients for `userId`, via the same write path the app uses. */
  async function seedMeal(userId: string, name: string, n: number, servings = 2) {
    const items: { foodItemId: string; quantityMultiplier: number }[] = []
    for (let i = 0; i < n; i++) {
      const f = (await pool.query(
        `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
         VALUES ($1,$2,50,$3,$4,$5,$6,'manual') RETURNING id`,
        [userId, `${name} ing ${i}`, 120 + i, 6.3 + i / 10, 11.1 + i / 10, 2.2 + i / 10])).rows[0].id as string
      items.push({ foodItemId: f, quantityMultiplier: 1.5 + i / 10 })
    }
    return repo.createSavedMeal(userId, name, items, undefined, servings)
  }

  it('answers every refusal with the same 404 body', async () => {
    await seedMeal(FRIEND, 'Secret stew', 2)
    await seedMeal(PENDING, 'Pending stew', 2)
    await setShare(PENDING, true)

    const refusals = [
      await call(NO_FRIENDSHIP),                 // no such friendship
      await call(pendingFriendship),             // pending, even though the requester opted in
      await call(strangersFriendship),           // two other people's accepted friendship
      await call(friendship),                    // accepted, friend never opted in (key absent)
    ]
    await setShare(FRIEND, false)
    refusals.push(await call(friendship))        // accepted, explicitly off
    await setShare(FRIEND, 'true')               // a non-boolean is not consent
    refusals.push(await call(friendship))

    for (const r of refusals) {
      expect(r.status).toBe(404)
      expect(r.body).toEqual({ error: 'Not found' })
      expect(r.cache).toBe('private, no-store')
    }
  })

  it('serves an accepted, opted-in friend — whichever end of the friendship they are', async () => {
    await seedMeal(FRIEND, 'Chilli', 3)
    await setShare(FRIEND, true)
    const ok = await call(friendship)
    expect(ok.status).toBe(200)
    expect(ok.cache).toBe('private, no-store')
    expect(ok.body.meals).toHaveLength(1)
    expect(ok.body.meals[0].meal.name).toBe('Chilli')

    // And from the other side: the friend reading mine, once I opt in.
    sessionUser = { id: FRIEND }
    await seedMeal(ME, 'Mine', 1)
    expect((await call(friendship)).status).toBe(404)
    await setShare(ME, true)
    const mine = await call(friendship)
    expect(mine.status).toBe(200)
    expect(mine.body.meals.map((m: { meal: { name: string } }) => m.meal.name)).toEqual(['Mine'])
  })

  it('closes again when the friend opts back out, or the friendship ends', async () => {
    await seedMeal(FRIEND, 'Chilli', 1)
    await setShare(FRIEND, true)
    expect((await call(friendship)).status).toBe(200)
    await setShare(FRIEND, false)
    expect((await call(friendship)).status).toBe(404)

    await setShare(FRIEND, true)
    await pool.query(`UPDATE friendships SET status = 'pending' WHERE id = $1`, [friendship])
    try { expect((await call(friendship)).status).toBe(404) }
    finally { await pool.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [friendship]) }
  })

  it('cannot be walked around with your own id or a user id', async () => {
    await seedMeal(ME, 'My own', 1)
    await seedMeal(FRIEND, 'Friend\'s', 1)
    await setShare(ME, true)
    await setShare(FRIEND, true)
    // The segment is a friendship id, so a USER id (mine or the friend's) matches no friendship.
    expect((await call(ME)).status).toBe(404)
    expect((await call(FRIEND)).status).toBe(404)
  })

  it('returns totals equal to the author\'s own, uncapped past 12 ingredients', async () => {
    const meal = await seedMeal(FRIEND, 'Mega bowl', 15, 3)
    await setShare(FRIEND, true)
    const { status, body } = await call(friendship)
    expect(status).toBe(200)
    const shared = body.meals[0].meal
    expect(shared.ingredients).toHaveLength(15)
    expect(shared.rolled).toBe(0)
    expect(shared.servings).toBe(3)

    const sum = (k: string) => shared.ingredients.reduce((a: number, i: Record<string, number>) => a + i[k], 0)
    const authors = (await repo.listSavedMeals(FRIEND)).find(m => m.id === meal.id)!.totals!
    // Per-ingredient rounding (grams to 0, kcal to 0, macros to 0.1) is the label's own, so the
    // copy agrees with the author to that rounding and no more.
    expect(Math.abs(sum('calories') - authors.calories)).toBeLessThanOrEqual(15 * 0.5)
    expect(Math.abs(sum('proteinG') - authors.proteinG)).toBeLessThanOrEqual(15 * 0.05 + 0.01)
    expect(Math.abs(sum('carbsG') - authors.carbsG)).toBeLessThanOrEqual(15 * 0.05 + 0.01)
    expect(Math.abs(sum('fatG') - authors.fatG)).toBeLessThanOrEqual(15 * 0.05 + 0.01)
  })

  it('omits a deleted meal, and sends nothing but name, servings, ingredients and macros', async () => {
    const keep = await seedMeal(FRIEND, 'Keeper', 2)
    const gone = await seedMeal(FRIEND, 'Goner', 2)
    await setShare(FRIEND, true)
    await expect(await repo.deleteSavedMeal(gone.id, FRIEND)).toBe(true)

    const { body } = await call(friendship)
    expect(body.meals.map((m: { meal: { name: string } }) => m.meal.name)).toEqual(['Keeper'])
    const entry = body.meals[0]
    expect(Object.keys(entry).sort()).toEqual(['meal', 'mealId', 'savedAt'])
    expect(entry.mealId).toBe(keep.id)
    expect(Object.keys(entry.meal).sort()).toEqual(['ingredients', 'name', 'rolled', 'servings'])
    expect(Object.keys(entry.meal.ingredients[0]).sort())
      .toEqual(['calories', 'carbsG', 'fatG', 'name', 'proteinG', 'weightG'])
    expect(JSON.stringify(body)).not.toContain(FRIEND)
  })

  it('keeps the same order however the friend eats: logging a meal does not reorder it', async () => {
    const a = await seedMeal(FRIEND, 'Meal A', 1)
    const b = await seedMeal(FRIEND, 'Meal B', 1)
    await pool.query(`UPDATE saved_meals SET created_at = now() - interval '1 hour' WHERE id = $1`, [a.id])
    await setShare(FRIEND, true)
    const names = async () => (await call(friendship)).body.meals.map((m: { meal: { name: string } }) => m.meal.name)
    expect(await names()).toEqual(['Meal B', 'Meal A'])

    const mt = (await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1,'Lunch') RETURNING id`, [FRIEND])).rows[0].id
    const item = (await pool.query(`SELECT food_item_id FROM saved_meal_items WHERE saved_meal_id = $1`, [a.id])).rows[0].food_item_id
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, saved_meal_id) VALUES ($1,'2026-10-20',$2,$3,$4)`,
      [FRIEND, mt, item, a.id])
    // The owner's own list moves A to the top (last eaten); the friend's view must not.
    expect((await repo.listSavedMeals(FRIEND))[0].id).toBe(a.id)
    expect(await names()).toEqual(['Meal B', 'Meal A'])
    void b
  })

  it('401 without a session, 400 for a malformed id, 429 once the viewer is over the limit', async () => {
    sessionUser = null
    expect((await call(friendship)).status).toBe(401)
    sessionUser = { id: ME }
    expect((await call('not-a-uuid')).status).toBe(400)

    let last = 0
    for (let i = 0; i < 31; i++) last = (await call(NO_FRIENDSHIP)).status
    expect(last).toBe(429)
  })
})
