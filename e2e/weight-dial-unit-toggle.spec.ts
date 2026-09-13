import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL } from './fixtures'

/**
 * BF-141 — the lb/kg toggle on the weight dial.
 *
 * **This spec exists because `touch-target-size.spec.ts` cannot reach this control, and BF-141 said
 * it could.** That spec scans `SCREENS = ['/', '/health', '/workout', '/nutrition', '/more']` — the
 * five tab roots. The dial lives inside an *active* workout at `/workout?session=…`, which none of
 * them is, so its empty allowlist would have stayed green over a 20 px suffix. The entry's claim
 * that it "will fail this if it is done any other way" is corrected on the entry.
 *
 * The toggle deliberately has almost no ink — the owner asked for *"a very small button ... something
 * you wouldnt see"* — so the drawn size is not the thing to assert. The reachable box is, and it
 * comes from `.tap-target-44`'s invisible `::before`, which is exactly the kind of thing that
 * silently stops applying.
 */

test.setTimeout(180_000)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

let preExistingSessionIds: string[] = []

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.user_id WHERE u.email = $1`,
      [SEED_EMAIL])
    preExistingSessionIds = rows.map(r => r.id)
  })
})

// A workout left mid-flight makes the NEXT spec's pre-workout screen offer "Continue Workout"
// instead of "Start Workout" — the specs share one database serially.
test.afterAll(async () => {
  await withDb(db => db.query(
    `DELETE FROM workout_sessions ws USING users u
      WHERE u.id = ws.user_id AND u.email = $1 AND NOT (ws.id = ANY($2::uuid[]))`,
    [SEED_EMAIL, preExistingSessionIds]))
})

/** Drive into the first set, which is where the dial is. */
async function openFirstSet(page: Page) {
  await page.goto('/workout')
  const startWorkout = page.getByRole('button', { name: 'Start Workout' })
  await startWorkout.waitFor({ timeout: 120_000 })
  await startWorkout.click()
  await page.waitForURL(/[?&]session=/, { timeout: 60_000 })

  const resume = page.getByRole('button', { name: 'Continue Workout' })
  await expect(startWorkout.or(resume).first()).toBeVisible({ timeout: 60_000 })
  await ((await resume.count()) ? resume : startWorkout).click()

  const beginExercises = page.getByRole('button', { name: 'Begin Exercises' })
  const startSet1 = page.getByRole('button', { name: 'Start Set 1' })
  await expect(beginExercises.or(startSet1).first()).toBeVisible({ timeout: 30_000 })
  if (await beginExercises.count()) await beginExercises.click()
  await startSet1.click()
  await expect(page.getByRole('button', { name: 'Log Set 1' })).toBeVisible({ timeout: 30_000 })
}

const toggle = (page: Page) => page.getByRole('button', { name: /^Weight unit: / })

test('the unit suffix is the control, and it is reachable at its drawn size', async ({ page }) => {
  await openFirstSet(page)

  const unit = toggle(page)
  await expect(unit).toBeVisible({ timeout: 30_000 })
  await expect(unit).toHaveAttribute('aria-label', /Weight unit: kg/)

  // Only the SELECTED row's suffix is interactive. The unit renders on every visible row, and three
  // live toggles in a scrolling column is not what "hidden" means.
  await expect(unit, 'one toggle, on the selected row only').toHaveCount(1)

  const box = await unit.evaluate(el => {
    const r = el.getBoundingClientRect()
    const before = getComputedStyle(el, '::before')
    return { ink: { w: r.width, h: r.height }, hit: { w: before.width, h: before.height } }
  })
  // The ink is deliberately small — that is the ask. The reachable box is what has to hold.
  expect(box.hit.w, `drawn ${box.ink.w}px wide`).toBe('44px')
  expect(box.hit.h, `drawn ${box.ink.h}px tall`).toBe('44px')
  // 44 px inside a 48 px row, which is `.tap-target-44`'s own rule: never a hit area larger than
  // the control's clearance.
  expect(box.ink.h).toBeLessThanOrEqual(48)
})

test('tapping the unit swaps the dial to pounds, converted rather than relabelled', async ({ page }) => {
  await openFirstSet(page)

  const unit = toggle(page)
  await expect(unit).toBeVisible({ timeout: 30_000 })
  const selected = page.locator('[role="option"][aria-selected="true"]').first()
  const before = (await selected.innerText()).trim()

  await unit.click()

  // The reading must change unit, not position.
  await expect(toggle(page)).toHaveAttribute('aria-label', /Weight unit: lb/, { timeout: 10_000 })
  const after = (await page.locator('[role="option"][aria-selected="true"]').first().innerText()).trim()
  expect(after, 'the suffix changed').not.toBe(before)
  expect(after).toMatch(/\blb$/)

  // Pounds, converted — not the same number relabelled, which is the trap the entry names.
  const kg = Number(before.replace(/[^\d.]/g, ''))
  const lb = Number(after.replace(/[^\d.]/g, ''))
  if (kg > 0) expect(lb, `${kg} kg should read near ${(kg / 0.45359237).toFixed(1)} lb`).toBeGreaterThan(kg)

  // **And back, with the weight intact.**
  //
  // ⚠ This does NOT prove `stopPropagation`, and saying so would be a false claim in a test name —
  // measured 2026-09-12 by removing it and watching this stay green. The row's own `onClick` calls
  // `onChange` with the row's value, which in lb mode round-trips kg → lb (2.5 lb detent) → kg and
  // IS lossy for some weights — 61.0 kg comes back 61.25. The seeded workout starts at 60 kg, which
  // round-trips exactly (132.5 lb → 60.0), so the propagation has nothing to change here. The guard
  // is real and seed-dependent; do not delete it because this spec passes without it.
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-label', /Weight unit: kg/, { timeout: 10_000 })
  const back = (await page.locator('[role="option"][aria-selected="true"]').first().innerText()).trim()
  expect(back, 'the tap must change the unit and nothing else').toBe(before)
})
