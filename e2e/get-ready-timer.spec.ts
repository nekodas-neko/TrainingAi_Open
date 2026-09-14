import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL } from './fixtures'

/**
 * A bodyweight ready screen counts down instead of running open-ended (BF-157).
 *
 * Owner, on the Pull-Up ready screen with the session clock at **8:42**: *"The body weight screens
 * have no warmup timer or load time so its just infinite on this screen."*
 *
 * The three-stage ramp is built from 50/74/92% of the working weight, so it is correctly absent when
 * there is no weight to take a percentage of — but the clock was rendered *from* that ladder, so
 * dropping one dropped the other. Four cases have no working weight: bodyweight, an AMRAP baseline,
 * solo mode, and an exercise logged at zero. All four showed nothing while the notification chip
 * counted down against `transitionSecForEquipment` — two surfaces disagreeing about whether the
 * phase is timed.
 *
 * **The spec creates the state it needs and restores it**, rather than reading whatever the seed
 * happens to hold. That took two goes. The first draft assumed the seed's exercises were unweighted
 * because none carries an `exercise_id`; the ready screen came up at **73.75 kg** with a full ramp,
 * so it proved nothing. The second looked a real `Pull-Up` row up in the sandbox and hardcoded its
 * uuid — which is a local id, and CI builds its own library, so the `UPDATE` died on
 * `session_exercises_exercise_id_fkey` and the spec was red there while green here.
 *
 * So it inserts its own row, by NAME, which is the one thing both databases agree on
 * (`exercise_library.name` is UNIQUE). Every session's opening exercise is repointed at it, because
 * the workout that gets recommended is not this spec's to choose. Teardown restores
 * `session_exercises` FIRST and drops the probe row second — the other order would leave
 * `ON DELETE SET NULL` to blank the ids it is about to rewrite.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } })
test.setTimeout(180_000)

/** `transitionSecForEquipment(['bodyweight'])` — the same 60 s `startRestChip` counts against. */
const EXPECTED_TOTAL = '1:00'

/** Distinct enough that it cannot collide with a real library row in either database. */
const PROBE_NAME = 'E2E Bodyweight Probe'

let probeId = ''
let preExistingSessionIds: string[] = []
let originals: Array<{ id: string; exercise_name: string; exercise_id: string | null }> = []

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: sessions } = await db.query<{ id: string }>(
      `SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.user_id WHERE u.email = $1`,
      [SEED_EMAIL])
    preExistingSessionIds = sessions.map(r => r.id)

    const { rows } = await db.query<{ id: string; exercise_name: string; exercise_id: string | null }>(
      `SELECT se.id, se.exercise_name, se.exercise_id
         FROM session_exercises se
         JOIN program_sessions ps ON ps.id = se.session_id
        WHERE se.position = 0 AND se.deleted_at IS NULL`)
    originals = rows
    expect(originals.length, 'no opening exercise to repoint — the seed changed').toBeGreaterThan(0)

    // Upsert rather than insert: a run that died before teardown leaves the row behind.
    const { rows: probe } = await db.query<{ id: string }>(
      `INSERT INTO exercise_library (name, equipment, exercise_type)
            VALUES ($1, '{bodyweight}', 'bodyweight')
       ON CONFLICT (name) DO UPDATE
             SET equipment = EXCLUDED.equipment, exercise_type = EXCLUDED.exercise_type
         RETURNING id`, [PROBE_NAME])
    probeId = probe[0].id

    await db.query(
      `UPDATE session_exercises SET exercise_name = $1, exercise_id = $2
        WHERE id = ANY($3::uuid[])`,
      [PROBE_NAME, probeId, originals.map(r => r.id)])
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    for (const o of originals) {
      await db.query(
        `UPDATE session_exercises SET exercise_name = $1, exercise_id = $2 WHERE id = $3`,
        [o.exercise_name, o.exercise_id, o.id])
    }
    // A workout left mid-flight makes the NEXT spec's pre-workout screen offer "Continue Workout"
    // instead of "Start Workout". This one never logs a set, but it does open a session.
    await db.query(
      `DELETE FROM workout_sessions ws USING users u
        WHERE u.id = ws.user_id AND u.email = $1 AND NOT (ws.id = ANY($2::uuid[]))`,
      [SEED_EMAIL, preExistingSessionIds])
    // Last, and only now that nothing references it.
    if (probeId) await db.query(`DELETE FROM exercise_library WHERE id = $1`, [probeId])
  })
})

test('the bodyweight ready screen shows a bounded get-ready clock', async ({ page }) => {
  await page.goto('/workout')

  const startWorkout = page.getByRole('button', { name: 'Start Workout' })
  await startWorkout.waitFor({ timeout: 120_000 })
  await startWorkout.click()
  await page.waitForURL(/[?&]session=/, { timeout: 60_000 })

  const resume = page.getByRole('button', { name: 'Continue Workout' })
  await expect(startWorkout.or(resume).first()).toBeVisible({ timeout: 60_000 })
  await ((await resume.count()) ? resume : startWorkout).click()

  // A 3-second countdown overlay sits between the press and the ready screen.
  const beginExercises = page.getByRole('button', { name: 'Begin Exercises' })
  const startSet1 = page.getByRole('button', { name: 'Start Set 1' })
  await expect(beginExercises.or(startSet1).first()).toBeVisible({ timeout: 30_000 })
  if (await beginExercises.count()) await beginExercises.click()

  // The ready screen, before any set is started — the screen the owner was stuck on at 8:42.
  await expect(startSet1).toBeVisible({ timeout: 30_000 })

  await expect(page.getByText('Get ready', { exact: true }), 'no bounded clock on the ready screen')
    .toBeVisible({ timeout: 15_000 })

  // No ladder, which is the half that was always correct: 50/74/92% of nothing is not a warm-up.
  await expect(page.getByText('Warm-up ramp-up')).toHaveCount(0)

  // **Bounded, and bounded at the chip's number.** The label alone would pass on a bar counting up
  // forever; the denominator is what makes this an assertion about the defect, and `startRestChip`
  // reads the same helper for the notification the lifter sees at the same moment.
  const clock = page.getByText(new RegExp(`^\\d+:\\d\\d / ${EXPECTED_TOTAL}$`))
  await expect(clock).toBeVisible({ timeout: 15_000 })

  // It ticks. A frozen bar at 0:00 satisfies everything above.
  const first = await clock.textContent()
  await expect.poll(async () => clock.textContent(), {
    timeout: 15_000, message: 'the ready clock never ticked',
  }).not.toBe(first)
})
