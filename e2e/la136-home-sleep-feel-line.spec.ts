import { test, expect, type Page } from '@playwright/test'
import { enableHomeCards, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * LA-136 — Home's sleep line shows what he rated, the right way round, and NOTHING when he did not.
 *
 * Built to `docs/design/2026-09-27-four-screen-mockups.html` §LA-136, approved 2026-09-27.
 *
 * **The morning check-in is stubbed rather than seeded, on purpose.** The whole behaviour here is a
 * function of one payload — a 1–5 and a touched flag — and the two cases that matter differ only in
 * that flag. Seeding them through the sheet would exercise the sheet, and the untouched case is the
 * one a DB fixture is least able to produce on demand.
 *
 * **Why the second test is the important one.** The morning sheet writes a NEUTRAL 3 for a scale he
 * never tapped, flagged `sleepQualityFeelTouched: false`. A raw column read puts
 * *"OK · 3/5 · Your rating, not a score"* on Home for a value nobody gave — which is the fabricated
 * `Sleep: OK` this entry exists to undo, down to the string. Four earlier readers in this repo made
 * exactly that mistake, against 78 such values.
 *
 * 384 px, not the harness default of 412: the width the mockup was drawn and approved at.
 */

// `serviceWorkers: 'block'` is not optional beside a route stub: the worker re-issues every
// `/api/` request and Playwright cannot intercept a service-worker fetch, so the stub would
// apply or not depending on whether the worker had claimed the page — green here, flaky on CI
// with the real route answering.
test.use({ viewport: { width: 384, height: 854 }, serviceWorkers: 'block' })

/** `stored: 2` → 'Good' and four of five dots, which is the state the mockup was drawn at. */
async function stubMorningCheckin(
  page: Page,
  body: { sleepQualityFeel: number | null; sleepQualityFeelTouched: boolean },
) {
  await page.route('**/api/day-checkin**', async route => {
    const url = route.request().url()
    if (route.request().method() !== 'GET' || !url.includes('phase=morning')) return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        perceivedRecovery: 3, perceivedRecoveryTouched: false,
        soreMuscles: [], journal: null, illnessContext: null, ...body,
      }),
    })
  })
}

const moodCard = (page: Page) =>
  page.locator('div[role="button"]').filter({ hasText: 'Exercise Readiness' })

async function openHomeWithMoodCard(page: Page) {
  await suppressMorningCheckin(page)
  await enableHomeCards(page, ['moodWidget'])
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ta_home_section_order', JSON.stringify(['card_moodWidget']))
      localStorage.setItem('ta_home_hidden_sections', JSON.stringify([]))
    } catch { /* storage blocked — the assertions below report it */ }
  })
  await page.goto('/')
  await settleRouteBoundary(page)
  // WAIT for the card, do not assert straight away: `settleRouteBoundary` returns while Home is
  // still painting skeletons, and a sibling spec measured a screen of grey blocks twice over.
  // "Exercise Readiness" also labels the separate readiness PROMPT banner, so any locator that does
  // not separate the two goes strict-mode ambiguous the moment both are up — which is how the first
  // two runs of this spec failed while the card was on screen the whole time. Both are clickable, so
  // the role does not separate them either; the ELEMENT does. The widget is a `div[role="button"]`,
  // the prompt a real `<button>`.
  await expect(moodCard(page), 'the mood card never painted').toBeVisible({ timeout: 60_000 })
}

test('a rating he gave shows his own word, the dots that match it, and the caption', async ({ page }) => {
  test.setTimeout(180_000)
  await stubMorningCheckin(page, { sleepQualityFeel: 2, sleepQualityFeelTouched: true })
  await openHomeWithMoodCard(page)

  // `stored: 2` is the SECOND-BEST night. Asserting the label rather than the number is what makes
  // this test able to fail on the inversion: the scale is stored 1 = great … 5 = terrible while its
  // labels run the other way, so a line that reads 'Poor' here is the bug, not a rounding choice.
  const line = page.getByText('Your rating, not a score')
  await expect(line, 'the sleep line never rendered for a rating he gave').toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Good', { exact: true }), 'expected his own word for a stored 2').toBeVisible()
  await expect(page.getByText('4/5', { exact: true })).toBeVisible()

  // Four of five dots filled, counted by computed colour rather than by class: the filled ones carry
  // `--brand` and the rest the border token, which is the distinction the mockup draws.
  const fills = await page.getByTestId('sleep-feel-dots').evaluate(el =>
    Array.from(el.querySelectorAll('span.rounded-full')).map(d => getComputedStyle(d).backgroundColor),
  )
  expect(fills.length, 'expected five dots').toBe(5)
  const distinct = new Set(fills)
  expect(distinct.size, 'the dots are all one colour — the rating is not being shown').toBe(2)
  expect(fills.filter(c => c === fills[0]).length, 'expected four filled dots for a stored 2').toBe(4)

  // Below the energy row, which is where the approved drawing put it.
  const [card, caption] = [await moodCard(page).boundingBox(), await line.boundingBox()]
  expect(caption!.y, 'the sleep line is not below the mood content').toBeGreaterThan(card!.y)
  expect(caption!.y + caption!.height, 'the sleep line escaped the mood card')
    .toBeLessThanOrEqual(card!.y + card!.height + 1)
})

test('an untouched neutral 3 puts NOTHING on Home — it is not a rating', async ({ page }) => {
  test.setTimeout(180_000)
  await stubMorningCheckin(page, { sleepQualityFeel: 3, sleepQualityFeelTouched: false })
  await openHomeWithMoodCard(page)

  // The card is up, so the line has had its chance to paint.
  await expect(page.getByText('Your rating, not a score'), 'an untouched seed reached Home as a rating')
    .toHaveCount(0)
  await expect(page.getByText('OK', { exact: true }), 'the fabricated "OK" is back on Home')
    .toHaveCount(0)
})
