import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { ensureEnergyBalanceProfile, enableHomeCards, settleRouteBoundary } from './fixtures'

/**
 * Home's nutrition card and the Nutrition tab's ring count against the SAME budget (Q-415 / Q-417),
 * and the ring's macro bars use the scaled targets that budget implies (Q-323).
 *
 * Three budgets were live on one screen, from the same data: the zone bar said 2,180, Home's donut
 * 2,451 and the Nutrition ring 2,001 — so one card printed "Goal reached" against 2,014 eaten while
 * the card two rows above said "166 kcal left". Both wrong figures were the same mistake:
 * `nutrition_targets.calories` — the **rest-day floor** — plus a separately-sourced burn, rather
 * than the budget `/api/nutrition/energy-balance` computes.
 *
 * **Each surface is asserted against the route's arithmetic, not against the other.** Two screens
 * agreeing is not the property that matters; they agreed before Q-401 as well, on a wrong number.
 * And `expectedBudget` is checked to differ from the old expression first, so a revert cannot pass.
 *
 * **The earned kcal comes from a heart-rate session, not a logged walk, and that is deliberate.**
 * The MET table is a vendored constant that this sandbox serves as synthetic fixtures, so an
 * activity's estimate is 0 here and `earned` would be 0 — under which the old and new expressions
 * differ only by the base, and the scaled macros equal the base ones. `estSessionKcal` prefers its
 * HR estimate (Keytel), which is pure arithmetic over age/weight/sex/bpm and real in any
 * environment.
 */

const SESSION_ID = '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d'
const BASE = { calories: 1900, proteinG: 150, carbsG: 190, fatG: 60 }

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM workout_hr_stats WHERE workout_session_id = $1', [SESSION_ID])
  await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
}

/** The route's own answer. Deriving the budget here instead would be a second implementation. */
async function budgetFromRoute(page: Page) {
  const res = await page.request.get('/api/nutrition/energy-balance')
  expect(res.ok(), 'energy-balance route must answer').toBeTruthy()
  const body = await res.json()
  expect(body.balance, 'the seeded profile must be complete enough to produce a balance').toBeTruthy()
  const { restingBaseKcal, targetNetKcal, activeKcal, intakeKcal } = body.balance
  const earned = Math.round(activeKcal)
  const total = Math.round(restingBaseKcal + targetNetKcal) + earned

  expect(earned, 'the HR-based session must reach the active-energy figure').toBeGreaterThan(0)
  // The mutation check, made explicit: `stored goal + earned` is what both surfaces used to print.
  // If it ever equals the real budget the fixture has stopped discriminating and must be retuned.
  expect(total, 'fixture must separate the real budget from the old expression')
    .not.toBe(BASE.calories + earned)

  return { total, earned, intakeKcal: Math.round(intakeKcal), scaled: body.macroTargets.scaled }
}

test.beforeAll(async () => {
  const userId = await ensureEnergyBalanceProfile()
  await withDb(async db => {
    await cleanup(db)
    const { rows } = await db.query<{ d: string; tz: string }>(
      `SELECT COALESCE((SELECT timezone FROM users WHERE id = $1), 'Australia/Brisbane') AS tz,
              (now() AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE id = $1), 'Australia/Brisbane'))::date::text AS d`,
      [userId],
    )
    const { d: today, tz } = rows[0]
    // 11:00→12:00 in the USER's zone on that day — not an offset from `now()`. An offset is a UTC
    // instant, and `computeEnergyBalance` windows the session by the user's local midnight: between
    // 00:00 and 02:00 Brisbane (14:00–16:00 UTC) `now() - 2 hours` is the PREVIOUS local day, the
    // session falls outside the window, `earned` is 0 and all three tests fail. That is the Q-356
    // class, and it is why both sides are anchored to the same local day here. Midday, not midnight:
    // a boundary is where an off-by-one stops being visible.
    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'Budget spec session',
               ($3::date + time '11:00') AT TIME ZONE $4,
               ($3::date + time '12:00') AT TIME ZONE $4, $2)`,
      [SESSION_ID, userId, today, tz],
    )
    await db.query(
      `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, readings_count, source)
       VALUES ($1, $2, 130, 120, 'oura_ble')`,
      [SESSION_ID, userId],
    )
    await db.query(
      `INSERT INTO nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g,
         carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g`,
      [userId, BASE.calories, BASE.proteinG, BASE.carbsG, BASE.fatG],
    )
    // BF-88: pin today's steps, because the whole point of this fixture is that its active energy
    // is the strength session and nothing else — the comment on the assertion below says so.
    //
    // It used to be pinned for free. Steps only counted above 3,000, so a small step count left on
    // this shared day by another spec contributed zero and was invisible here. Steps now count from
    // the first one, so an untouched day is no longer a controlled one.
    //
    // **It only shows up in the full serial suite, which is why it reads as a CI-only failure.** On
    // its own this spec passes with or without the pin — the day is undisturbed. Run behind 130-odd
    // other specs against one shared database and it is not, and BF-88's first CI run failed this
    // assertion twice, on the initial attempt and the retry. Adding the pin turned the same run
    // green. That is the evidence for it; the precise writer was never identified, and does not need
    // to be, because the fixture should not have depended on one.
    await db.query(
      `INSERT INTO body_metrics (user_id, date, steps) VALUES ($1, $2::date, 0)
       ON CONFLICT (user_id, date) DO UPDATE SET steps = 0`,
      [userId, today],
    )

    expect(today, 'sanity: the fixture day resolved').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

test.afterAll(async () => { await withDb(cleanup) })

test('the Nutrition ring counts against the budget the zone bar describes', async ({ page }) => {
  const { total, earned, intakeKcal } = await budgetFromRoute(page)

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // BF-24 ② split this across two lines: the header reads `+N burned` and the word "movement" moved
  // down to the zone bar's detail. Both are asserted, because each carries half of what this test is
  // for — the header proves the earned figure is on screen at all, and "movement", not "cardio", is
  // the wording that matters (the figure includes strength sessions and steps, and this fixture's
  // whole contribution is a strength session — the exact case the old wording mislabelled).
  await expect(page.getByText(`+${earned} burned`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(`${earned} earned from movement`)).toBeVisible()

  // The ring prints what is LEFT rather than the budget, and that remaining figure is what read
  // "Goal reached" on a day with 166 kcal still to eat.
  //
  // Matched loosely because BF-24 ② now formats it: `3196` renders as `3,196 kcal left`. Not
  // `left.toLocaleString()` — that resolves in the RUNNER's locale, and the browser's need not
  // agree, which is a green-today-red-elsewhere trade for a separator nothing here cares about.
  const left = Math.max(0, total - intakeKcal)
  const kcalLeft = new RegExp(`${String(left).replace(/\B(?=(\d{3})+(?!\d))/g, '[,.\\s]?')}\\s*kcal left`)
  await expect(left > 0 ? page.getByText(kcalLeft) : page.getByText('Goal reached')).toBeVisible()
})

test('the ring\'s macro bars use the scaled targets, not the stored ones', async ({ page }) => {
  const { scaled } = await budgetFromRoute(page)
  // Protein is dosed per kg of bodyweight and deliberately does NOT scale, so carbs and fat are the
  // two that must move — asserting on protein would pass against the bug.
  expect(Math.round(scaled.carbsG), 'fixture must actually scale carbs').toBeGreaterThan(BASE.carbsG)

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // `\s*` before the unit, not a bare `g`. BF-24 ② renders `{grams}<span>/{target}</span><span> g</span>`
  // (`energy-card.tsx:225`), so the text node is `0/295 g` — and the space is why the negative
  // assertion below MATTERS: written as `/NNNg` it matched nothing at all after that change, so it
  // reported 0 whether or not the base target was on screen. A guard that cannot fail is not a guard.
  const perTarget = (grams: number) => new RegExp(`/${grams}\\s*g`)
  await expect(page.getByText(perTarget(Math.round(scaled.carbsG)))).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(perTarget(Math.round(scaled.fatG)))).toBeVisible()
  await expect(page.getByText(perTarget(BASE.carbsG))).toHaveCount(0)
})

test('Home\'s nutrition card counts against that same budget', async ({ page }) => {
  await enableHomeCards(page, ['nutritionDonut'])
  const { total } = await budgetFromRoute(page)

  await page.goto('/')
  await settleRouteBoundary(page)

  // `N / M kcal`, where M is the budget — the line that read `1458 / 2447` above a subtitle saying
  // `1,629 base + 547 earned from movement`, which sums to 2,176.
  await expect(page.getByText(new RegExp(`\\d[\\d,]* / ${total} kcal`))).toBeVisible({ timeout: 30_000 })
})
