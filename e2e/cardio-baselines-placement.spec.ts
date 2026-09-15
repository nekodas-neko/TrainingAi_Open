import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * BF-159 — Cardio Baselines belongs on the Cardio tab, and only there.
 *
 * Owner, having had to be told where the Cooper test lives: *"That section should be moved to cardio
 * hub."* It was in the Health tab's Training list, between *Muscle Volume This Week* and *Workout
 * Density* — every card around it about lifting, this one holding VO₂max and heart-rate recovery.
 *
 * **This is a MOVE, and both halves are asserted for the same reason.** `/baselines` has exactly one
 * entrance in the whole app and this card is it, so all three protocols (6MWT, Cooper, Resting HR +
 * Recovery) are reachable only through it. Leaving a copy behind on Health would be two entrances to
 * one destination, which is how a stale copy starts; removing it without landing it on Cardio would
 * strand the page entirely. Neither half is safe to check alone.
 */
test.use({ serviceWorkers: 'block' })
test.setTimeout(120_000)

test('the baselines card is on the Cardio tab and gone from Health', async ({ page }) => {
  await suppressMorningCheckin(page)

  await page.goto('/cardio')
  await settleRouteBoundary(page)

  const card = page.getByText('Cardio Baselines', { exact: true })
  await expect(card, 'the card never reached the Cardio tab').toBeVisible({ timeout: 60_000 })

  // Still the entrance it always was. The move is worthless if the link did not come with it.
  const link = page.locator('a[href="/baselines"]')
  await expect(link).toHaveCount(1)

  await page.goto('/health')
  await settleRouteBoundary(page)

  // The Training panel is where it used to sit, so prove that panel really rendered before reading
  // anything into the card's absence — an empty screen would pass this vacuously.
  await expect(page.getByText(/Muscle Volume|Workout Density|This Week/).first())
    .toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Cardio Baselines', { exact: true })).toHaveCount(0)
})
