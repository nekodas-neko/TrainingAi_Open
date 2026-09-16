import { test, expect, type Page } from '@playwright/test'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * BF-5 PR 2b — the week in review is a page (`/health/week`), not a banner that expands.
 *
 * **What this can and cannot prove.** `/api/weekly-digest` POSTs through an LLM and 5xxs in this
 * environment — `tabs-instant-paint.spec.ts` lists it under `EXPECTED_5XX` for exactly that reason —
 * so the first test exercises the real failure path, which is what a harness run actually reaches.
 * The second stubs the route to drive the render: that proves the PAGE draws the metrics it is
 * given, and says nothing about whether the route computes them correctly. PR 2a's own tests own
 * that half.
 */

/**
 * Derived from the seeded user's zone, never written down — `check-e2e-stub-dates` enforces that,
 * and rightly: a literal is only safe when BOTH sides are fixed, and "the page renders what it is
 * handed" is one assumption away from stopping being true. 'en-CA' is what yields YYYY-MM-DD.
 */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

/** The Monday of the week that has ENDED, which is the only week the digest ever describes. */
const WEEK_START = (() => {
  const dow = new Date(`${TODAY}T00:00:00Z`).getUTCDay()   // 0 = Sunday
  // `shiftDateStr` rather than hand-rolled UTC arithmetic: it is the repo's day-string shift, and a
  // second copy of it here would be a second copy of a formula (CLAUDE.md, One Formula One Place) —
  // and the hand-rolled one reached for the banned `toISOString().slice()`.
  return shiftDateStr(shiftDateStr(TODAY, dow === 0 ? -6 : 1 - dow), -7)
})()
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => shiftDateStr(WEEK_START, i))

const METRICS = {
  weekStart: WEEK_START,
  weekEnd: WEEK_DAYS[6],
  priorWeekStart: shiftDateStr(WEEK_START, -7),
  training: {
    sessions: 5,
    priorSessions: 4,
    volumeKg: 21354,
    priorVolumeKg: 17719,
    volumeChangePct: 20.5,
    byDay: [5200, 0, 4100, 3900, 0, 4254, 3900].map((volumeKg, i) => ({
      date: WEEK_DAYS[i], volumeKg, sessions: volumeKg > 0 ? 1 : 0,
    })),
  },
  muscleSets: [{ muscle: 'hamstrings', sets: 14 }, { muscle: 'glutes', sets: 12 }],
  prs: [{ exerciseName: 'Barbell Bench Press', estimated1rm: 103, description: '103 kg' }],
  hrv: { week: 56, priorWeek: 52, source: 'overnight', byDay: day(56) },
  readiness: { week: 66, priorWeek: 71, byDay: day(66) },
  sleepScore: { week: 65, priorWeek: 68, byDay: day(65) },
  sleepHours: { week: 6.7, priorWeek: 7.1, byDay: day(6.7) },
  stressHighMinutes: { week: 45, priorWeek: 60, byDay: day(45) },
  illness: null,
  resilience: null,
  ots: null,
  weightChangeKg: null,
  friendCount: null,
}

function day(v: number) {
  // One null in the middle, deliberately: an unmeasured day must be a GAP in the line rather than a
  // zero, and a fixture with no holes could not tell the two apart.
  return WEEK_DAYS.map((date, i) => ({ date, value: i === 3 ? null : v }))
}

async function openWeek(page: Page) {
  await suppressMorningCheckin(page)
  await page.goto('/health/week')
  await settleRouteBoundary(page)
}

test('the page says so when the digest fails, rather than showing an empty screen', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/weekly-digest', r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' }))
  await openWeek(page)

  // Q-499's class: a card that vanishes on failure leaves the user unable to tell a quiet week from
  // a broken one. The tap retries, because the page fetches once.
  await expect(page.getByText('Your week in review didn’t load')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Tap to try again')).toBeVisible()
})

test('and draws the metrics it is given', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/weekly-digest', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ digest: 'A solid week, maintaining these gains.', weekStart: METRICS.weekStart, metrics: METRICS }),
    }))
  await openWeek(page)

  await expect(page.getByRole('heading', { name: 'Week in review' })).toBeVisible({ timeout: 30_000 })
  // The training headline the digest describes in prose, drawn.
  await expect(page.getByText('21,354')).toBeVisible()
  await expect(page.getByText(/21% on 17,719 kg/)).toBeVisible()
  // The week-over-week pair, which is the comparison the paragraph makes.
  await expect(page.getByText('Readiness', { exact: true })).toBeVisible()
  await expect(page.getByText(/↓ 5 on 71/)).toBeVisible()
  // A PR reads from its formatted description — never re-derived from the raw 1RM (Q-19).
  await expect(page.getByText('Barbell Bench Press')).toBeVisible()
  // Charts are canvases; that they mounted at all is what a DOM assertion can honestly claim.
  expect(await page.locator('canvas').count()).toBeGreaterThan(1)
})

test('the Health tab carries a permanent way in, which outlives the dismissible banner', async ({ page }) => {
  await suppressMorningCheckin(page)
  // The Training panel, reached by its own param rather than a tap — the entry sits beside the
  // calendar the owner compared the page to.
  await page.goto('/health?tab=training')
  await settleRouteBoundary(page)

  const entry = page.getByRole('button', { name: /Week in review/ })
  await entry.scrollIntoViewIfNeeded()
  await expect(entry).toBeVisible({ timeout: 30_000 })

  await entry.evaluate(el => (el as HTMLElement).click())
  await expect(page).toHaveURL(/\/health\/week/)
})
