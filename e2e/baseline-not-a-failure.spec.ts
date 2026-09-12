import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-146 — a first session is told to establish a baseline, and must not also be told that failed.
 *
 * The server deliberately refuses to prescribe while `phase === 'baseline' && !baselineComplete`:
 * a prescription is a percentage of a 1RM and there is no 1RM before the AMRAP. The client
 * funnelled that 400 into `prescriptionGenTimedOut` — a *timeout* flag — so the state was drawn in
 * amber with a retry that can never succeed, under a panel already explaining it correctly.
 *
 * **The entry says this is reproducible without a device, and it is: the state is one row.** This
 * puts the seeded user's recommended session into it, opens the card, and puts the row back.
 */

test.setTimeout(180_000)

const FAILURE_BANNER = /Couldn't generate your AI prescription just now/
const PREPARING = /Preparing your AI workout/

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

interface Saved { id: string; phase: string; baselineComplete: boolean }
let saved: Saved | null = null

test.beforeAll(async () => {
  saved = await withDb(async db => {
    // Whichever session the Workout tab will recommend — the row is found by the user, not by a
    // hardcoded session name, which the no-hardcoded-sessions rule requires.
    const { rows } = await db.query<Saved>(
      `SELECT sp.id, sp.phase, sp.baseline_complete AS "baselineComplete"
         FROM session_periodization sp JOIN users u ON u.id = sp.user_id
        WHERE u.email = $1 ORDER BY sp.updated_at DESC LIMIT 1`, [SEED_EMAIL])
    expect(rows[0], `${SEED_EMAIL} has no session_periodization row — run pnpm db:local`).toBeTruthy()
    await db.query(
      `UPDATE session_periodization
          SET phase = 'baseline', baseline_complete = false, prescription = NULL,
              prescription_status = 'none'
        WHERE id = $1`, [rows[0].id])
    return rows[0]
  })
})

test.afterAll(async () => {
  if (!saved) return
  await withDb(db => db.query(
    `UPDATE session_periodization SET phase = $2, baseline_complete = $3 WHERE id = $1`,
    [saved!.id, saved!.phase, saved!.baselineComplete]))
})

test('a session still establishing its baseline is not told the refusal was a failure', async ({ page }) => {
  await page.goto('/workout')
  await settleRouteBoundary(page)

  const start = page.getByRole('button', { name: 'Start Workout' })
  await start.waitFor({ timeout: 120_000 })
  await start.click()
  await page.waitForURL(/[?&]session=/, { timeout: 60_000 })

  // Anchor on something present before asserting absence: `toHaveCount(0)` is satisfied by a page
  // that failed to render at all, which is exactly the defect this would then miss.
  await expect(page.getByRole('button', { name: /Start Workout|Continue Workout/ }).first())
    .toBeVisible({ timeout: 60_000 })

  // The whole bounded poll would have elapsed by now on the old build — the banner trips after it.
  await page.waitForTimeout(12_000)

  await expect(page.getByText(FAILURE_BANNER), 'the refusal is expected, not a failure').toHaveCount(0)
  await expect(page.getByText(PREPARING), 'a generation that cannot succeed is not "preparing"').toHaveCount(0)
})
