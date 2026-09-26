import { test, expect, type Page } from '@playwright/test'
import { suppressMorningCheckin, settleRouteBoundary } from './fixtures'

/**
 * TN-85 — last night's verdict has a home that lasts the day, and a correction is one tap from it.
 *
 * **The morning modal is not a home for this**, which is the finding the entry exists for: it
 * auto-opens once, retires itself on close, and only lives on `/session-select`. The owner has
 * saved 82 of those sheets in three months and touched a scale in 3 of them, so an announcement
 * delivered only there produces silence — and the whole instrument is him *disagreeing*, which
 * makes silence and agreement indistinguishable.
 *
 * **The verdict is stubbed rather than seeded.** It is a 28-night rolling baseline over three
 * components; arranging one in the seed would be arranging the engine's answer, and the engine is
 * already tested at `lib/__tests__/sleep-verdict-route.test.ts`. What is untested without this is
 * the wiring: that the note renders what the route returns, and that the correction reaches the
 * one surface where the value can actually be set.
 */
// The app asks for `todayInTz(session.user.timezone)`, never the runner's day — and a literal
// here would pin one side of that comparison to a date that stops being today tomorrow.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

test.use({ serviceWorkers: 'block' })

const VERDICT = {
  date: TODAY, verdict: 'poor', triggered: ['duration', 'onset'],
  components: { durationHours: 5.17, onsetMinutes: 80, efficiency: 82 },
  bands: { durationLow: 6.5, durationHigh: 8, onsetLow: -80, onsetHigh: 15, efficiencyLow: 88, efficiencyHigh: 94 },
  baselineNights: 28, modelVersion: 1, responseState: 'none',
}

async function homeWithVerdict(page: Page, verdict: unknown) {
  const posts: unknown[] = []
  const gets: string[] = []
  await page.route('**/api/sleep-verdict**', async route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    }
    gets.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verdict }) })
  })
  // The sleep CARD is off by default on a fresh account, and the note hangs off it.
  await page.addInitScript(() => localStorage.setItem('ta_ss_cards', JSON.stringify(['sleepWidget'])))
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)
  return { posts, gets }
}

test('the verdict is stated on Home, numbers before the verdict, with no question asked', async ({ page }) => {
  test.setTimeout(180_000)
  await homeWithVerdict(page, VERDICT)

  const line = page.getByText('Slept 5h10, 65 min later than usual. Marked this a poor night.')
  await expect(line, 'the note never rendered — Home is the durable home for the verdict').toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('?', { exact: true })).toHaveCount(0)
})

test('"That\'s wrong" records the disagreement and opens the sheet where the value is set', async ({ page }) => {
  test.setTimeout(180_000)
  const { posts } = await homeWithVerdict(page, VERDICT)

  const correct = page.getByRole('button', { name: "That's wrong" })
  await expect(correct).toBeVisible({ timeout: 60_000 })
  await correct.scrollIntoViewIfNeeded()
  await correct.click()

  // The correction's VALUE belongs to the check-in save path (TN-57); this records only that he
  // disagreed, and then hands him the one surface that can take the value.
  await expect(page.getByRole('heading', { name: 'Morning Check-in' })).toBeVisible({ timeout: 20_000 })
  expect(posts, 'the disagreement was never recorded').toEqual([{ date: TODAY, state: 'corrected' }])
})

test('nothing is said when there is no verdict — a daily "not enough data" is a card that gets tuned out', async ({ page }) => {
  test.setTimeout(180_000)
  const { gets } = await homeWithVerdict(page, null)

  // The anchor is the request itself, not some other element on the page: it proves the note
  // MOUNTED and asked, so the absence below is a decision rather than a screen that never painted.
  await expect.poll(() => gets.length, { timeout: 60_000 }).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: "That's wrong" })).toHaveCount(0)
  await expect(page.getByText('Marked this a', { exact: false })).toHaveCount(0)
})
