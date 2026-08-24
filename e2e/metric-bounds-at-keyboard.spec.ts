import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * An implausible body metric is refused at the keyboard, and never reaches the database (Q-321).
 *
 * `packages/shared/src/validation/body-metrics.ts` has held every one of these bounds for months
 * and was imported by nothing under `components/` or `app/` except the API route. So a 5,000 kg
 * weight was accepted by the sheet, written to the local store, queued, pushed — and discarded
 * server-side, where the number the user typed never appeared again. The bounds were never
 * missing; the client just never asked.
 *
 * **What discriminates here, and what does not — measured, because the first framing was wrong.**
 * The obvious guard is "the value must not reach `body_metrics`". That assertion is real and is
 * kept, but on this runtime it is **not** what catches the regression: mutation-checked by
 * restoring the old `valueNum <= 0` check, saving 5,000 kg, and polling the table — it passed.
 * `getLocalStore` returns null in the web sandbox, so the sheet takes its API fallback, and
 * `BodyMetadataPostSchema` refuses 5,000 with a 400. The row was never written either way.
 *
 * The path the entry describes — stored locally, queued, pushed, discarded server-side — is the
 * DEVICE path, and it cannot run here at all. So the discriminating assertions are the two client
 * ones: the inline message naming the bound, and Save disabled. Those fail on the old check and
 * pass on the new one. The database poll stays as an invariant, not as the guard.
 */

const DAY_OFFSET_NOTE = 'today, in the user timezone — read back from the app, never composed here'
const IMPLAUSIBLE_KG = '5000'
const PLAUSIBLE_KG = '81.6'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/** The seeded user's id and their local day — `${DAY_OFFSET_NOTE}`. */
async function userAndToday(db: Client): Promise<{ userId: string; today: string }> {
  const { rows } = await db.query<{ id: string; timezone: string | null }>(
    'SELECT id, timezone FROM users WHERE email = $1', [SEED_EMAIL],
  )
  const userId = rows[0]?.id
  expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  // Derived in Postgres in the USER's zone rather than from node's clock, so the two sides of every
  // comparison below come from the same place. A UTC "today" is the previous local day between
  // 00:00 and 10:00 Brisbane, which is the shape that has taken this suite red before.
  const { rows: [d] } = await db.query<{ day: string }>(
    `SELECT to_char((now() AT TIME ZONE COALESCE($1, 'Australia/Brisbane'))::date, 'YYYY-MM-DD') AS day`,
    [rows[0].timezone],
  )
  return { userId, today: d.day }
}

async function weightOnDay(db: Client, userId: string, day: string): Promise<number | null> {
  const { rows } = await db.query<{ weight_kg: string | null }>(
    'SELECT weight_kg FROM body_metrics WHERE user_id = $1 AND date = $2', [userId, day],
  )
  const raw = rows[0]?.weight_kg
  return raw == null ? null : Number(raw)
}

test.describe.configure({ mode: 'serial' })

type Page = import('@playwright/test').Page

/** A real CDP touch sequence — `.click()` dispatches a mouse-only sequence that never produces a
 *  `click` event on these screens (Q-354). Retried while the sheet is CLOSED only: once it opens,
 *  the dialog covers the button and every retry fails on an element that is no longer visible. */
async function openWeightSheet(page: Page): Promise<void> {
  // `?tab=body` because the weight card is on Health's Body tab and the screen defaults to Training.
  // The Body Weight card's own Log button, not the first on the page — Body Fat and Steps carry one
  // too, and which comes first is a layout detail this spec should not depend on.
  const card = page.locator('div').filter({ hasText: /^Body Weight ↗/ }).last()
  const logButton = card.getByRole('button', { name: 'Log', exact: true })
  await expect(logButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    const box = (await logButton.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await expect(page.getByRole('dialog').getByText(/Log Body Weight/)).toBeVisible({ timeout: 10_000 })
}

test('an out-of-range weight is refused, and nothing is written', async ({ page }) => {
  const { userId, today } = await withDb(db => userAndToday(db))
  const before = await withDb(db => weightOnDay(db, userId, today))

  await page.goto('/health?tab=body')
  await settleRouteBoundary(page)
  await openWeightSheet(page)

  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="number"]').fill(IMPLAUSIBLE_KG)

  // The message names the real bound, so it tells the user what to type instead.
  await expect(dialog.getByRole('alert')).toContainText(/between 20 and 500 kg/, { timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()

  // The claim that matters: the value did not reach the database. Polled rather than read once,
  // since the write this guards against was fire-and-forget and would land after the assertion.
  await expect.poll(
    () => withDb(db => weightOnDay(db, userId, today)),
    { timeout: 10_000, message: 'an implausible weight must not be written' },
  ).toBe(before)
})

test('a plausible weight still saves', async ({ page }) => {
  const { userId, today } = await withDb(db => userAndToday(db))

  await page.goto('/health?tab=body')
  await settleRouteBoundary(page)
  await openWeightSheet(page)

  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="number"]').fill(PLAUSIBLE_KG)
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  const save = dialog.getByRole('button', { name: 'Save' })
  await expect(save).toBeEnabled()
  await save.click()

  // Guards the obvious over-correction: a bound that refuses everything would pass the test above.
  await expect.poll(
    () => withDb(db => weightOnDay(db, userId, today)),
    { timeout: 20_000, message: 'a plausible weight must still be written' },
  ).toBeCloseTo(Number(PLAUSIBLE_KG), 1)
})
