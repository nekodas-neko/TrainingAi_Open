import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { ensureEnergyBalanceProfile, settleRouteBoundary } from './fixtures'

/**
 * BF-154. The sentence under the macro row names the day's budget and then breaks it into terms.
 * Those terms were the addends of the formula BF-152 retired, printed beside a budget the new one
 * produced, so the sentence contradicted itself: *"Today's budget is 1,294 — 2,278 resting burn,
 * −200 for your goal, +0 moved."* `2,278 − 200 + 0 = 2,078`, 784 kcal from the number it had just
 * named.
 *
 * **Asserted by parsing the rendered sentence and doing its own arithmetic**, rather than by
 * matching an expected string. The defect was never the wording — every candidate wording is fine
 * so long as the terms sum to the budget in front of them — and a string match would go red on the
 * next copy edit while staying green on the thing that was wrong. The unit guard
 * (`components/nutrition/__tests__/bf154-budget-breakdown-addends.test.ts`) pins the source shape;
 * this pins what a person actually reads.
 */

const TARGETS_BACKUP: { row: Record<string, unknown> | null } = { row: null }
const SESSION_ID = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5'
let userId = ''

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  userId = await ensureEnergyBalanceProfile()
  await withDb(async db => {
    const { rows } = await db.query('SELECT * FROM nutrition_targets WHERE user_id = $1', [userId])
    TARGETS_BACKUP.row = rows[0] ?? null
    // Grams well clear of any plausible budget, so the explanatory paragraph is guaranteed to render
    // — it is suppressed under MACRO_BUDGET_GAP_KCAL, where the two numbers read as one and the
    // sentence would be noise. 220p + 260c + 90f = 2,730 kcal.
    await db.query(
      `INSERT INTO nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g)
       VALUES ($1, 2730, 220, 260, 90)
       ON CONFLICT (user_id) DO UPDATE
         SET calories = 2730, protein_g = 220, carbs_g = 260, fat_g = 90`,
      [userId],
    )
    // Movement, so the figure-printing branch is exercised too — it carries the arithmetic claim,
    // and a run that only ever saw the zero-earned wording would leave that half unasserted. A
    // heart-rate session rather than a walk: the sandbox serves the MET table as synthetic
    // fixtures, so an activity estimates to 0.
    await db.query('DELETE FROM workout_hr_stats WHERE workout_session_id = $1', [SESSION_ID])
    await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'BF-154 spec session', now() - interval '2 hours', now() - interval '1 hour', $2)`,
      [SESSION_ID, userId],
    )
    await db.query(
      `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, readings_count, source)
       VALUES ($1, $2, 130, 120, 'oura_ble')`,
      [SESSION_ID, userId],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM workout_hr_stats WHERE workout_session_id = $1', [SESSION_ID])
    await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
    const r = TARGETS_BACKUP.row
    if (r == null) { await db.query('DELETE FROM nutrition_targets WHERE user_id = $1', [userId]); return }
    await db.query(
      `UPDATE nutrition_targets SET calories = $2, protein_g = $3, carbs_g = $4, fat_g = $5
        WHERE user_id = $1`,
      [userId, r.calories, r.protein_g, r.carbs_g, r.fat_g],
    )
  })
})

test('the budget the sentence names equals the terms it breaks it into', async ({ page }) => {
  const res = await page.request.get('/api/nutrition/energy-balance')
  expect(res.ok()).toBeTruthy()
  const b = (await res.json()).balance
  expect(b, 'the seeded profile must produce a balance').toBeTruthy()
  const { total, base, earned, anchoredToRestingRate, chain } = budgetProvenance(b)

  // The discriminator. If the fixture's anchored budget happened to equal the retired expression,
  // this spec would pass against the defect itself — which is the trap `calorie-progress-bar.spec.ts`
  // documents for the same reason.
  expect(anchoredToRestingRate, 'fixture must exercise the anchored path — the branch that broke').toBe(true)
  // Issue 2071: the old discriminator (`restingBase + targetNet + earned`) can no longer separate
  // anything. The owner's budget is RMR − deficit + (20% of RMR − step credit) + movement, which is
  // built from the same terms as `restingBase` (RMR scaled up, less the step credit) and `targetNet`
  // (the deficit), so on an unfloored day the two coincide (both read 2,804 on this fixture).
  // What a reverted `budgetProvenance` would print is the BF-152 budget — the bare resting rate
  // plus movement — so that is what the fixture must be separated from.
  expect(total, 'fixture must separate the budget from the BF-152 one (resting rate + movement)')
    .not.toBe(Math.round(b.restingRateKcal) + Math.round(b.activeKcal))
  // Issue 2071: the line is a chain of signed terms, which only exists on the live-payload path and
  // only while the floor is not setting the whole day (then the line names the floor instead).
  expect(chain, 'a live payload must carry the budget chain').toBeTruthy()
  expect(chain!.totalFloored, 'fixture must not sit on the floor, or the line prints no terms').toBe(false)

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // BF-154's build half deleted the card's own `Today's budget is …` paragraph: it lived inside
  // `{macroGap != null && …}`, and the grams are now fitted TO the budget, so there is no gap left
  // for a sentence to explain. The reconciliation property did not go with it — `CalorieZoneBar`
  // prints the same breakdown and is now the only surface that does, so the assertion follows it
  // there rather than being dropped.
  const sentence = page.getByText(/resting rate/).first()
  await expect(sentence).toBeVisible({ timeout: 30_000 })
  // The earned half appends a parenthetical breakdown of its own addends — "(120 workout, 35
  // steps)" — which are terms of `earned`, not of the budget. Stripped, or they would be counted
  // twice.
  const clause = (await sentence.innerText()).replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ')

  // Issue 2071: "1,304 resting rate − 232 for your goal + 161 daily living + 237 earned from
  // movement". Each term is read WITH its sign, so the arithmetic below is the reader's own.
  const num = (m: RegExpMatchArray | null) => (m ? Number(m[m.length - 1].replace(/,/g, '')) : null)
  const signed = (m: RegExpMatchArray | null) => (m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, '')) : 0)
  const rmr = num(clause.match(/^\s*(\d[\d,]*) resting rate/))
  const goal = signed(clause.match(/([−+-]) (\d[\d,]*) for your goal/))
  const living = signed(clause.match(/([−+-]) (\d[\d,]*) daily living/))
  const moved = earned > 0 ? num(clause.match(/\+ (\d[\d,]*) earned from movement/)) : 0

  expect(rmr, `"${clause}" — the sentence leads with the resting rate`).toBe(chain!.rmr)
  // Not the estimator field it replaced on screen, which is the regression this spec exists for.
  expect(rmr).not.toBe(Math.round(b.restingBaseKcal))
  // The deficit is a subtraction on screen, whatever its sign in the payload.
  expect(goal, `"${clause}" — the goal term`).toBe(0 - chain!.deficit)
  expect(living, `"${clause}" — the daily living term`).toBe(chain!.dailyLiving)

  if (earned > 0) {
    expect(moved, `"${clause}" — the earned term must be named`).toBe(earned)
    // Each term is rounded on its own, so the printed sum can sit 1 kcal off the budget (the
    // component's own comment says so); anything larger is the contradiction this spec exists for.
    const sum = rmr! + goal + living + moved!
    expect(Math.abs(sum - total), `"${clause}" — the terms must add up to the budget ${total}`).toBeLessThanOrEqual(1)
  } else {
    // Nothing earned: the chain is the still-day budget, and the sentence says so in words.
    expect(base, 'a term-free sentence is only honest when the budget is the base').toBe(total)
    expect(clause).toMatch(/no movement recorded yet today/)
    expect(Math.abs(rmr! + goal + living - total)).toBeLessThanOrEqual(1)
  }
})

test('no figure labelled resting appears twice with different values', async ({ page }) => {
  // The worse half of the report: 2,278 as "resting burn" ten lines above 1,294 as "resting rate",
  // one of them the inflated estimator the app has stopped using.
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  const resting = [...body.matchAll(/(\d[\d,]*)\s*resting (?:rate|burn)/g)]
    .map(m => Number(m[1].replace(/,/g, '')))
  expect(resting.length, 'the page must show at least one resting figure').toBeGreaterThan(0)
  expect(new Set(resting).size, `two different figures both named resting: ${resting.join(', ')}`).toBe(1)
})
