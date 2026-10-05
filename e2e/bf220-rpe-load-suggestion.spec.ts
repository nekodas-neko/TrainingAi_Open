import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, STORAGE_STATE } from './fixtures'

/**
 * BF-220 in a browser — the half only a browser can show.
 *
 * The decision is unit-tested to the number (`components/workout/__tests__`). What those cannot show
 * is that the offer reaches the screen: that logging a hard, short set puts the pill on the NEXT set
 * card, that taking it moves the weight dial, and that dismissing it leaves the session alone.
 *
 * **The `reducedMotion` context option is load-bearing, not tidiness.** `Start Set N` carries
 * `animate-bounce` while the phase is `rest`, and Playwright's actionability check needs a stable
 * box for two frames — an infinite animation never gives one, so the click hangs to the timeout.
 * `workout-set-loop.spec.ts` measured it: 85 ms with the rule, blocked after 8 s without.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

/** The pill's own landmark — `role="group"` with this name, so no text match can drift into it. */
const PILL = 'Load suggestion from your last set'

/**
 * **Cleanup is not tidiness here — without it this spec breaks the NEXT run, including other
 * people's.** Each run starts a workout and logs sets; the sessions it leaves behind accumulate, and
 * a later run resumes into a state it did not set up. Measured the hard way: after a few runs of
 * this file, `workout-set-loop.spec.ts` — untouched, on `origin/main` — began failing with *"the
 * three logged sets never reached the database"*, and `pnpm db:rebuild` was what restored it. CI
 * seeds a fresh database per shard and never sees this; a persistent local one does. Sessions are
 * identified by the set that existed BEFORE, exactly as the sibling spec does, because `started_at`
 * is client-supplied and an id high-water mark does not exist for a uuid.
 */
let preExistingSessionIds: string[] = []

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.user_id WHERE u.email = $1`,
      [SEED_EMAIL])
    preExistingSessionIds = rows.map(r => r.id)
  })
})

test.afterAll(async () => {
  await withDb(db => db.query(
    `DELETE FROM workout_sessions ws USING users u
      WHERE u.id = ws.user_id AND u.email = $1 AND NOT (ws.id = ANY($2::uuid[]))`,
    [SEED_EMAIL, preExistingSessionIds]))
})

test('a hard set that falls short offers a lighter next set, and taking it moves the dial', async ({ page }) => {
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

  // Nothing is owed before a set is logged — the offer reads the set he JUST finished.
  await expect(page.getByRole('group', { name: PILL })).toHaveCount(0)

  // Fall two reps short of the prescription, and rate it at the top of the scale. Both are the
  // conditions the engine's back-off branch turns on; neither is invented by the app.
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /^Decrease reps to / }).first().click()
  await page.getByRole('button', { name: '10', exact: true }).first().click()

  await page.getByRole('button', { name: 'Log Set 1' }).click()

  const startSet2 = page.getByRole('button', { name: 'Start Set 2' })
  await expect(startSet2).toBeVisible({ timeout: 30_000 })

  // The offer, on the next set's card.
  const pill = page.getByRole('group', { name: PILL })
  await expect(pill).toBeVisible({ timeout: 30_000 })
  // The engine's own sentence, not a second wording of the same reason.
  await expect(pill).toContainText(/RPE ran high and you fell short of the prescribed reps/)

  const offered = (await pill.getByText(/Drop to [\d.]+ kg\?/).innerText()).match(/([\d.]+)/)![1]

  // Taking it pre-fills the dial and nothing else: the session is still on set 2, unstarted.
  await pill.getByRole('button', { name: 'Use it' }).click()
  await expect(page.getByText(`${offered}`, { exact: false }).first()).toBeVisible()
  await expect(startSet2).toBeVisible()
})

test('the offer can be dismissed, and dismissing it starts no set', async ({ page }) => {
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

  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /^Decrease reps to / }).first().click()
  await page.getByRole('button', { name: '10', exact: true }).first().click()
  await page.getByRole('button', { name: 'Log Set 1' }).click()

  const pill = page.getByRole('group', { name: PILL })
  await expect(pill).toBeVisible({ timeout: 30_000 })
  await pill.getByRole('button', { name: 'Dismiss load suggestion' }).click()
  await expect(pill).toHaveCount(0)
  // Declining leaves the session exactly where it was.
  await expect(page.getByRole('button', { name: 'Start Set 2' })).toBeVisible()
})
