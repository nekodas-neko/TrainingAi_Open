import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { ZERO_DATA_EMAIL, ZERO_DATA_STORAGE_STATE } from './fixtures'

/**
 * LA-181 — the Manage-friends sheet gave every pending row Accept/Decline. Accept on a request you
 * SENT always fails (the server accepts only as the addressee), and since `RV-195` masks the target
 * of an outgoing request the row could not even name who it went to: *"Unknown"* beside two buttons
 * that cannot work.
 *
 * The split itself is unit-tested. What only a browser can show is the pair of views over the SAME
 * request — the sender's and the addressee's — which is the whole of what the entry asked to check.
 *
 * The request this sends is deleted afterwards, so the suite's friendship table is left as found.
 */
// Serial and in this order: the second test reads the request the first one sends.
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block' })

const openManageSheet = async (page: import('@playwright/test').Page) => {
  await page.goto('/more?tab=friends', { waitUntil: 'networkidle' })
  const manage = page.getByRole('button', { name: /Manage/ })
  await expect(manage).toBeVisible({ timeout: 30_000 })
  await manage.click()
  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
}

test.afterAll(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      `DELETE FROM friendships
        WHERE requester_id = (SELECT id FROM users WHERE email = $1)
           OR addressee_id  = (SELECT id FROM users WHERE email = $1)`,
      [ZERO_DATA_EMAIL],
    )
  } finally {
    await db.end()
  }
})

test('the sender sees "Request sent" with a Cancel, not Accept/Decline', async ({ page }) => {
  await openManageSheet(page)

  await page.getByPlaceholder(/friend code|email/i).fill(ZERO_DATA_EMAIL)
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText('Request sent', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible()
  // The bug in one assertion: the row used to say "Unknown" and offer an Accept that always failed.
  await expect(page.getByText('Unknown')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Accept / })).toHaveCount(0)
})

test('the addressee sees the sender by name, with Accept and Decline', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ZERO_DATA_STORAGE_STATE })
  const page = await context.newPage()
  try {
    await openManageSheet(page)
    await expect(page.getByText('Pending Requests')).toBeVisible({ timeout: 20_000 })
    // RV-195 reveals the requester to the addressee on purpose — they need it to decide.
    await expect(page.getByRole('button', { name: /^Accept Test User/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Decline Test User/ })).toBeVisible()
    await expect(page.getByText('Request sent', { exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
