import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, expectNoSkeleton } from './fixtures'

/**
 * Q-297 — Nutrition's day navigation: drive the day, assert which day is selected, then check.
 *
 * The entry asks for the treatment `health-tabs-instant-paint.spec.ts` gave Health, applied to
 * "Nutrition's date swipe and any other tabbed surface". Two things it assumed are not true, and
 * both narrow the job rather than widen it:
 *
 *  - **Nutrition has no tabs.** `SwipeCarousel` is used by exactly one screen (`health-content.tsx`)
 *    plus two pickers, so there is no second multi-panel surface to cover. What Nutrition has is a
 *    *day*, and the panel-selection question becomes a day-selection one.
 *  - **The day has two entry points that must agree** — the header chevrons (`setSelectedDate` +
 *    `shiftDateStr`) and a `?date=` deep link applied in an effect, used by the Home timeline's meal
 *    cards. Nothing pinned them to each other.
 *
 * Not driven by the swipe gesture, deliberately: `useDrag` on this screen swallows mouse input
 * (Q-354, open), which is what Playwright sends, so a swipe-driven spec would be asserting against a
 * known-broken path. The chevrons are real buttons and are what this covers.
 */

/**
 * The day N back **in the user's own timezone**, read from Postgres — never
 * `new Date().toISOString().slice(0, 10)`, which is the UTC date and is yesterday in Brisbane until
 * 10am. Same helper shape as `nutrition-tail-order.spec.ts`, and for the same reason: a spec that
 * derives the day differently from the app is asking about a different day than it means to.
 */
async function daysBackInUserTz(days: number): Promise<string> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try {
    const { rows } = await db.query<{ d: string }>(
      `SELECT ((now() AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE email = $1), 'Australia/Brisbane'))::date
               - $2::int)::text AS d`,
      [SEED_EMAIL, days],
    )
    return rows[0].d
  } finally {
    await db.end()
  }
}

/**
 * The header's day label. Anchored to the Previous-day button rather than to its text or its
 * classes: the text is the thing under test, and a class-based locator would break on any restyle
 * while proving nothing about the day.
 */
function dayLabel(page: Page) {
  return page.getByRole('button', { name: 'Previous day' }).locator('xpath=preceding-sibling::span[1]')
}

test('the chevron and the ?date= deep link land on the same day', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(dayLabel(page)).toHaveText('Today')

  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(dayLabel(page), 'one press back must be Yesterday').toHaveText('Yesterday')

  // The deep link the Home timeline's meal cards use. It is applied in an effect, so the first
  // paint is Today and the label settles afterwards — `toHaveText` retries through that.
  const yesterday = await daysBackInUserTz(1)
  await page.goto(`/nutrition?date=${yesterday}`)
  await settleRouteBoundary(page)
  await expect(dayLabel(page), 'the deep link must select the same day the chevron did')
    .toHaveText('Yesterday')
})

test('Next day is refused at today, and the button is clickable so the guard has to hold', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(dayLabel(page)).toHaveText('Today')

  const next = page.getByRole('button', { name: 'Next day' })
  // `aria-disabled`, not `disabled` — the browser dispatches the click either way, and the only
  // thing stopping tomorrow is `if (selectedDate >= todayStr) return` in the handler. A spec that
  // asserted the attribute instead would pass with that guard deleted.
  await expect(next).toHaveAttribute('aria-disabled', 'true')
  // `force` because **Playwright counts `aria-disabled` as not-enabled** and waits it out: without
  // it this line does not fail, it hangs to the 45 s test timeout (measured). Forcing is the
  // faithful analogue rather than a workaround — a real tap on the S25 reaches the handler too,
  // since `aria-disabled` blocks no pointer event. Nothing else here is forced.
  await next.click({ force: true })

  await expect(dayLabel(page), 'the day must not advance past today').toHaveText('Today')
})

test('a day already viewed paints without a skeleton on return', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const prev = page.getByRole('button', { name: 'Previous day' })
  const next = page.getByRole('button', { name: 'Next day' })

  // First visit fills the caches for that day; the assertion is about the second, which is what the
  // instant-paint rule is about ("First paint shows last-known data, not a spinner"). The day's
  // caches are date-keyed, so this is also the guard for a key that forgets its date.
  await prev.click()
  await expect(dayLabel(page)).toHaveText('Yesterday')
  await expectNoSkeleton(page)

  await next.click()
  await expect(dayLabel(page)).toHaveText('Today')

  await prev.click()
  await expect(dayLabel(page)).toHaveText('Yesterday')
  await expectNoSkeleton(page)
})
