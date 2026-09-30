import { test, expect, type Page } from '@playwright/test'
import { shiftDateStr, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { STORAGE_STATE } from './fixtures'

/**
 * LB-162's three converted bars, SEEN — the half its `Keep:` recorded as owed after two attempts
 * that produced no evidence.
 *
 * Both earlier failures are in that entry and both are avoided here rather than retried:
 * Home came up on the **zero-data** account, where the Body Battery card is absent (this file pins
 * `STORAGE_STATE`, the seeded user, and a probe confirmed the card renders there); and a Health-tab
 * capture stopped above the muscle-sets card even at `fullPage: true` while scrolling to it by text
 * timed out at 180 s. The muscle-sets card is reached through **`/health/week`** instead — a pushed
 * route that renders it near the top — with the payload stubbed, because the seeded account's own
 * week has no muscle sets (`Muscle volume this week` renders 0 times without a stub).
 *
 * **These assert COMPUTED STYLE and BOUNDING BOXES, not class names.** `RV-72` moved six bars from
 * `width` to `transform: scaleX()`, and the whole risk of that conversion is geometric: which end
 * the fill grows from, and whether a rounded fill gets clipped. A class assertion would restate the
 * source; a box is the thing the owner would be looking at.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

/** A fill rendered by `ProgressFill`: the transform is inline, so this cannot match a static bar. */
const FILL = 'div[style*="scaleX"]'

test('Body Battery empties from the LEFT — the fill is anchored to the track’s right edge', async ({ page }) => {
  // Stubbed so the level is a KNOWN value below 100. At 100 the fill covers the track and the
  // direction it grows from is unobservable, which is a silent pass rather than a result.
  await page.route('**/api/body-battery', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      current: 40, label: 'Good', trend: 'draining',
      anchor: 78, anchorSource: 'readiness', anchorProvisional: false,
      charged: 4, drained: 42, wakeTime: Date.now() - 6 * 3_600_000,
      series: [{ t: Date.now() - 3_600_000, v: 55 }, { t: Date.now(), v: 40 }],
      hasData: true,
      // ⚠ `confidence` is an OBJECT, not a band string, and `label` is one of four capitalised
      // values. A `'moderate'` label with `confidence: 'ok'` took the whole card off the page —
      // the heading itself stopped rendering, which reads as "this screen does not have a Body
      // Battery" rather than as a bad fixture. Both shapes are pinned by their own types.
      confidence: { sampleCount: 400, wakingMinutes: 600, samplesPerHour: 40, sufficient: true },
      hrMax: { value: 190, source: 'estimated', observedPeak: null, peakDays: 0 },
      stress: null,
    }),
  }))

  await page.goto('/')
  const heading = page.getByText(/Body Battery/i).first()
  await expect(heading).toBeVisible({ timeout: 120_000 })

  // The card's own bar: the track is the `h-2 rounded-full overflow-hidden` sibling under the
  // heading, and the fill is the only element in it carrying an inline `scaleX`.
  const card = page.locator('div').filter({ hasText: /Energy left right now/ }).last()
  const fill = card.locator(FILL).first()
  await expect(fill).toBeVisible({ timeout: 30_000 })

  // ⚠ Read as a RATIO of the element's own layout width, not as the string `100%`. Chromium
  // resolves `transform-origin` to USED PIXEL values — `origin-right` computes to `"354px 4px"`
  // here, so a `startsWith('100%')` check fails against a correct bar. `offsetWidth` is the
  // untransformed layout width, which `scaleX` does not change.
  const { originFrac, origin } = await fill.evaluate((el: HTMLElement) => ({
    origin: getComputedStyle(el).transformOrigin,
    originFrac: parseFloat(getComputedStyle(el).transformOrigin) / el.offsetWidth,
  }))
  const track = fill.locator('..')

  const f = (await fill.boundingBox())!
  const t = (await track.boundingBox())!
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ origin, fill: f, track: t }))

  // ① The mechanism, read off the browser rather than off the class list: the origin sits at the
  //    element's right edge, so `scaleX` shrinks it rightward.
  expect(originFrac, `transform-origin is "${origin}", which is not this element's right edge`)
    .toBeCloseTo(1, 2)

  // ② The consequence. At 40% the painted fill hugs the track's RIGHT edge and leaves the left
  //    three-fifths empty — so the tank drains from the left, which is the entry's pass test.
  expect(Math.abs((f.x + f.width) - (t.x + t.width))).toBeLessThan(2)
  expect(f.x - t.x).toBeGreaterThan(t.width * 0.4)
  expect(f.width).toBeLessThan(t.width * 0.6)
})

/**
 * The muscle-sets row is the one conversion that needed a nested clipper: the outer track stays
 * `overflow-visible` so two `h-3` target markers can escape an `h-2` track, and the fill is clipped
 * one level in. Both halves of that are geometric, and this is the only place they are checked.
 */
test('a muscle-sets row clips its fill and still lets the target marker stand proud', async ({ page }) => {
  // Through the app's OWN helpers, and `pnpm lint` is why rather than taste: the first version
  // computed Monday from `getDay()` (device-local) and formatted it with `.toISOString().slice(0,10)`
  // (UTC), which the `no-restricted-syntax` rule refuses outright — and correctly, because the two
  // disagree for the ten hours before 10am AEST. This page keys its cache on the week it asked for
  // (`weekly-digest:${week}`), so a fixture a day out would stub a week the page is not showing.
  const weekStart = startOfWeekInTz()
  const weekEnd = shiftDateStr(weekStart, 6)
  const priorWeekStart = shiftDateStr(weekStart, -7)
  const wow = () => ({ week: null, priorWeek: null, byDay: [] })

  await page.route('**/api/weekly-digest**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      metrics: {
        weekStart, weekEnd, priorWeekStart,
        training: { sessions: 3, priorSessions: 2, volumeKg: 8000, priorVolumeKg: 7000, volumeChangePct: 14, byDay: [] },
        // One row, deliberately UNDER its target, so the marker sits to the right of the fill's
        // edge and the two cannot be confused for one another.
        muscleSets: [{ muscle: 'chest', sets: 6, targetSets: 14 }],
        prs: [],
        hrv: { ...wow(), source: null },
        readiness: wow(), sleepScore: wow(), sleepHours: wow(), stressHighMinutes: wow(),
        illness: null, resilience: null, ots: null, weightChangeKg: null, friendCount: null,
      },
    }),
  }))

  await page.goto('/health/week')
  await expect(page.getByText('Muscle volume this week')).toBeVisible({ timeout: 120_000 })

  const row = page.locator('div.relative.h-2.rounded-full').first()
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeVisible({ timeout: 30_000 })

  const fill = row.locator(FILL).first()
  // The markers are the row's direct children that are NOT the clipping wrapper. Located by
  // STRUCTURE rather than by `div.h-3`, so the height assertion below is what does the work — a
  // class rename must not be able to turn this test green, and a `h-3` locator would fail by
  // finding nothing rather than by measuring anything.
  const marker = row.locator('> div:not(.overflow-hidden)').first()
  await expect(fill).toBeVisible()
  await expect(marker).toBeVisible()

  const r = (await row.boundingBox())!
  const f = (await fill.boundingBox())!
  const m = (await marker.boundingBox())!
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ row: r, fill: f, marker: m }))

  // ① The marker stands PROUD: taller than the track, and overhanging it top and bottom. `h-3`
  //    against `h-2` is 12 px against 8, so this fails the moment the track starts clipping.
  expect(m.height).toBeGreaterThan(r.height)
  expect(m.y).toBeLessThan(r.y)
  expect(m.y + m.height).toBeGreaterThan(r.y + r.height)

  // ② The fill IS clipped — it stays inside the track it sits in, which is what stops a
  //    `scaleX`-ed rounded fill reading oval at a low percentage.
  expect(f.y).toBeGreaterThanOrEqual(r.y - 1)
  expect(f.height).toBeLessThanOrEqual(r.height + 1)
  expect(f.x).toBeGreaterThanOrEqual(r.x - 1)

  // ③ And the two are distinguishable: 6 sets against a target of 14 puts the marker clear of the
  //    fill's right edge. A row where they coincided would assert nothing about either.
  expect(m.x).toBeGreaterThan(f.x + f.width)
})
