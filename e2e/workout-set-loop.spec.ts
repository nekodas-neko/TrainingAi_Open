import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL } from './fixtures'

/**
 * The workout write path can be driven past the first set (Q-461).
 *
 * The Start Set button carries `animate-bounce` while `workoutPhase === 'rest'` — the W1 affordance
 * `CLAUDE.md` documents by design. Playwright's actionability check needs a stable bounding box for
 * two consecutive frames and an infinite animation never gives one, so **`Start Set 2` hung to the
 * test timeout** while every earlier step passed. The app's core write path was unautomatable past
 * set 1, on the harness built to catch exactly the regressions Q-450 and Q-451 shipped unguarded.
 *
 * Measured on this spec's own flow, before and after the fix:
 *
 *     reducedMotion=reduce          animation=none | 1            CLICKED in 85ms
 *     reducedMotion=no-preference   animation=bounce | infinite   BLOCKED after 8009ms
 *
 * So the affordance is untouched for anyone who has not asked for less motion — which is the point.
 * This is a testability fix, not a repair of a user-facing defect.
 *
 * `force: true` is deliberately NOT used anywhere here. It bypasses every actionability check
 * including "is this covered by an overlay", so a spec written that way would keep passing straight
 * through a real regression — the failure this guard exists to prevent.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } })

// The dev server compiles /workout on first hit and the pre-workout screen fans out several
// fetches, so this one is slower than the 45 s default rather than flaky.
test.setTimeout(180_000)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

// `workout_sessions.id` is a uuid and `started_at` is supplied by the client, so neither an id
// high-water mark nor a timestamp identifies what this spec created. The set of pre-existing ids
// does, exactly.
let preExistingSessionIds: string[] = []
let setLogsBefore = 0

async function countSetLogs(db: Client): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM set_logs sl
       JOIN exercise_logs el ON el.id = sl.exercise_log_id
       JOIN workout_sessions ws ON ws.id = el.workout_session_id
       JOIN users u ON u.id = ws.user_id
      WHERE u.email = $1`, [SEED_EMAIL])
  return Number(rows[0]?.n ?? 0)
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.user_id WHERE u.email = $1`,
      [SEED_EMAIL])
    preExistingSessionIds = rows.map(r => r.id)
    setLogsBefore = await countSetLogs(db)
  })
})

// The specs share one database serially, so a workout left mid-flight would make the NEXT spec's
// pre-workout screen offer "Continue Workout" instead of "Start Workout". Delete what this one
// created rather than leaving that for the next reader to discover.
test.afterAll(async () => {
  await withDb(db => db.query(
    `DELETE FROM workout_sessions ws USING users u
      WHERE u.id = ws.user_id AND u.email = $1 AND NOT (ws.id = ANY($2::uuid[]))`,
    [SEED_EMAIL, preExistingSessionIds]))
})

test('a workout can be driven through three sets without force-clicking', async ({ page }) => {
  await page.goto('/workout')

  // The Workout tab's recommendation card, then the pre-workout screen it opens. Both carry a
  // button reading "Start Workout"; the session id in the URL is what tells them apart.
  const startWorkout = page.getByRole('button', { name: 'Start Workout' })
  await startWorkout.waitFor({ timeout: 120_000 })
  await startWorkout.click()
  await page.waitForURL(/[?&]session=/, { timeout: 60_000 })

  // "Continue Workout" appears instead when one is already in flight.
  const resume = page.getByRole('button', { name: 'Continue Workout' })
  await expect(startWorkout.or(resume).first()).toBeVisible({ timeout: 60_000 })
  await ((await resume.count()) ? resume : startWorkout).click()

  // A 3-second countdown overlay sits between the press and the warm-up.
  const beginExercises = page.getByRole('button', { name: 'Begin Exercises' })
  const startSet1 = page.getByRole('button', { name: 'Start Set 1' })
  await expect(beginExercises.or(startSet1).first()).toBeVisible({ timeout: 30_000 })
  if (await beginExercises.count()) await beginExercises.click()

  await startSet1.click()

  for (const n of [1, 2, 3]) {
    const log = page.getByRole('button', { name: `Log Set ${n}` })
    await expect(log).toBeVisible({ timeout: 30_000 })
    await log.click()

    // Logging the last prescribed set ends the exercise, so the terminal state is either the
    // in-exercise "Complete →" or the per-exercise summary screen behind it.
    const next = page.getByRole('button', { name: `Start Set ${n + 1}` })
    const done = page.getByRole('button', { name: /^(Complete|Next Exercise)/ })
    await expect(next.or(done).first()).toBeVisible({ timeout: 30_000 })
    if (!(await next.count())) break

    // The click Q-461 is about. Without the reduced-motion rule this times out.
    await expect(next).toHaveCSS('animation-name', 'none')
    await next.click({ timeout: 10_000 })
  }

  // Three sets reached the database, not just the screen. Polled rather than read once: the log
  // write is deliberately fire-and-forget so the UI never waits on the network (CLAUDE.md, "Saves
  // feel instant"), so a single read straight after the last tap races it.
  await expect
    .poll(async () => (await withDb(countSetLogs)) - setLogsBefore,
      { timeout: 30_000, message: 'the three logged sets never reached the database' })
    .toBeGreaterThanOrEqual(3)
})
