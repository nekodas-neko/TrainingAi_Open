import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * The service worker takes no part in what this asserts — `hydrateUserPreferences` is warmed by a
 * React component — and leaving it on cost a CI run.
 *
 * **What is known:** the relaunch below failed on CI, twice, with `page.goto: net::ERR_ABORTED`,
 * before any assertion ran, and the SW was active in both attempt windows (`GET /sw.js 200`,
 * `GET /offline 200`). **What is not known:** the abort does not reproduce in the sandbox with the
 * SW on, so this is not proved by mutation — it removes the one actor CI's log implicates that has
 * no business being in this test. `card-429-error-state.spec.ts` blocks it for the same class of
 * reason. If the abort returns, the SW was not it.
 *
 * `page.reload()` is NOT the alternative: measured here, it aborts the navigation every run.
 */
test.use({ serviceWorkers: 'block' })

/**
 * Preferences survive a fresh install (Q-392).
 *
 * The owner's report: *"when i do a new install or open on computer - it loses all the saved
 * preferences. We need to make it persist across installs/etc."* The engine — `users.preferences`
 * plus `GET`/`PATCH /api/user/preferences` — had shipped and **no read site called it**, so nothing
 * user-visible had changed and this was still true.
 *
 * `localStorage.clear()` is the fresh install, from the only angle that matters here: every
 * preference surface reads its `localStorage` key during render, so a device with none of them is
 * exactly a device that has just been installed.
 *
 * **The encodings are the assertion, not an incidental detail.** They are not uniform —
 * `ta_weight_lookback` is a bare number and the reminder toggles are `String(boolean)` compared at
 * their read sites against the literal `'false'`. A value seeded in the wrong shape reads as the
 * default and the setting looks lost anyway, which is the bug wearing a different hat.
 */
test('a preference set on the server is seeded onto a device that has none', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await settleRouteBoundary(page)

  const patch = await page.evaluate(async () => {
    const res = await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weightLookback: 30, scoreRingStyle: 'arc', mealReminders: false }),
    })
    return res.status
  })
  expect(patch, 'the preferences route should accept the patch').toBe(200)

  // The fresh install.
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await settleRouteBoundary(page)

  // Seeded by `hydrateUserPreferences`, which the sync provider warms on launch — so this polls
  // rather than sampling once.
  await expect.poll(
    () => page.evaluate(() => ({
      weightLookback: localStorage.getItem('ta_weight_lookback'),
      scoreRingStyle: localStorage.getItem('ta_score_ring_style'),
      mealReminders: localStorage.getItem('ta_pref_meal_reminders'),
    })),
    { message: 'the server bag should seed the device keys on launch', timeout: 30_000 },
  ).toEqual({
    weightLookback: '30',      // a bare number, not JSON
    scoreRingStyle: 'arc',
    mealReminders: 'false',    // the literal the read sites compare against
  })
})
