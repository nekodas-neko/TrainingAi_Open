import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * The evening wrap-up draws the same read-through `/health/day` draws (Q-112b).
 *
 * The value being guarded is **one implementation, not two**: `DayReadThrough` is rendered by both
 * hosts off the same `day-log:<date>` cache key. A second copy would look identical on the day it
 * was written and drift from the next section change onward, which is the failure this exists to
 * make loud.
 *
 * **LB-105 — both halves of that claim were broken, in opposite directions.**
 *
 * The wrap-up test failed on a clean `origin/main` in the sandbox and passed on CI. It asserted that
 * a section label was visible, and every section of `DayReadThrough` self-hides when its domain is
 * empty; the local seed has nothing at all recorded for today, so the dialog was legitimately blank.
 * A spec that is red locally and green on CI is worse than one that is simply wrong — it trains a
 * session to skip it, which is how a genuine failure gets waved through. So this now **records an
 * activity for today** and removes it again, rather than reading whatever the seed happens to hold.
 *
 * The `/health/day` test had the opposite problem: it passed on that same empty day. Its regex
 * matched `^Sleep$`, and that screen renders a **`Sleep` score cell** of its own, above the
 * read-through — so it was satisfied by a label that is not a section and would have passed with
 * `DayReadThrough` absent entirely. Both tests now scope to `data-testid="day-read-through"`.
 *
 * The label list was wrong too: the component renders **`Body composition`**, which `^Body$` never
 * matched.
 */

/** What `day-sections.tsx` actually renders, checked against the file rather than remembered. */
const SECTION_LABELS = /^(Training|Activity|Energy|Sleep|Body composition|Heart rate through the day)$/

let seededActivityId = ''

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: users } = await db.query<{ id: string; timezone: string | null }>(
      'SELECT id, timezone FROM users WHERE email = $1', [SEED_EMAIL])
    const user = users[0]
    expect(user, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

    // The user's local day, read back from Postgres in their own timezone rather than computed here
    // — the app buckets by the user's day, and a UTC "today" is the wrong one for two hours of it.
    const { rows: days } = await db.query<{ d: string }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`,
      [user.timezone ?? 'Australia/Brisbane'])

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO activity_logs (user_id, date, activity_type, title, duration_min, calories_burned)
            VALUES ($1, $2, 'walk', 'Read-through fixture walk', 20, 80)
         RETURNING id`,
      [user.id, days[0].d])
    seededActivityId = rows[0].id
  })
})

test.afterAll(async () => {
  if (!seededActivityId) return
  await withDb(db => db.query('DELETE FROM activity_logs WHERE id = $1', [seededActivityId]))
})

test('the wrap-up shows the day it is wrapping up', async ({ page }) => {
  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)

  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })

  // Scoped to the read-through itself. Asserting on labels rather than on any one day's numbers is
  // still right — the numbers are the seed's, the labels are the component's — but the label has to
  // come from inside the component for that to mean anything.
  const sections = review.getByTestId('day-read-through').getByText(SECTION_LABELS)
  await expect(sections.first()).toBeVisible({ timeout: 60_000 })
})

test('the same section labels appear on /health/day', async ({ page }) => {
  // The other half of the claim. If these two ever diverge, one host grew its own copy.
  await page.goto('/health/day')
  await settleRouteBoundary(page)
  const sections = page.getByTestId('day-read-through').getByText(SECTION_LABELS)
  await expect(sections.first()).toBeVisible({ timeout: 60_000 })
})

test('the wrap-up steps through to a Save', async ({ page }) => {
  // The step rule (Q-112b): step 1 is the day and is never omitted, the meals step is skipped once
  // every configured meal has something logged, and the wrap-up holds the Save. So the number of
  // Nexts between opening and Save is *data-dependent* — pressing until Save appears is the only
  // shape that does not encode the seed's meal coverage into the test.
  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)

  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })
  // Exact, and including the separator the header actually renders. `getByText` matches
  // SUBSTRINGS, and a step title is a short English phrase — "The day" is inside the summary card's
  // "Totals are the day's figures…" one line below it. (The title is not "Your day" because the
  // digest card on this step carries that as its eyebrow, which is the LB-23 shape; swapping it for
  // a phrase that appears in body copy is the same trap wearing a different hat, and this is what
  // closes both.)
  await expect(review.getByText('· The day', { exact: true })).toBeVisible()

  const save = review.getByRole('button', { name: 'Save' })
  const next = review.getByRole('button', { name: 'Next' })
  // Bounded: three steps exist, so more than three presses means the flow does not terminate.
  for (let i = 0; i < 3 && await next.isVisible(); i++) await next.click()

  await expect(save).toBeVisible({ timeout: 30_000 })
  await expect(next).toHaveCount(0)
  // Stepping back must reach the read-through again — a one-way flow would strand a user who
  // stepped past it. The control is "Previous" rather than "Back" because a sore-muscle chip on
  // this very step is labelled "Back", and two identically-named buttons is an accessibility
  // defect first and a strict-mode violation second.
  await review.getByRole('button', { name: 'Previous' }).click()
  await expect(review.getByRole('button', { name: 'Next' })).toBeVisible()
})

/**
 * The week-window fetch is gated on the wrap-up being OPEN (Q-112d).
 *
 * `EndOfDayReview` is rendered unconditionally by `nutrition-content`; `open` only drives Radix.
 * So a hook in that component's body would fire on every visit to the Nutrition tab, for a payload
 * nobody has asked to see — which is why `DayTrendsSection` is its own child of `SheetContent`,
 * exactly as `DayReadThroughSection` is.
 *
 * **This is the half no unit test can reach**, and it is written against the request rather than
 * the rendered rows on purpose: whether any row draws depends on what the seed recorded in the
 * eight days before today, and encoding that here would make the test a statement about fixtures.
 * Whether the request happens at all does not.
 */
test('the week window is fetched when the wrap-up opens, and not before', async ({ page }) => {
  const calls: string[] = []
  page.on('request', req => {
    if (new URL(req.url()).pathname === '/api/day-review/week-window') calls.push(req.url())
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Something on the tab must have settled before "no request yet" means anything — otherwise this
  // passes on a page that has not finished loading.
  await expect(page.getByRole('button', { name: 'End of Day', exact: true })).toBeVisible({ timeout: 60_000 })
  expect(calls, 'the Nutrition tab must not pay for a sheet nobody opened').toHaveLength(0)

  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBeGreaterThan(0)
})
