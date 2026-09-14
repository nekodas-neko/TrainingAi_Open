import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * **The abort returned, so the service worker was not it (LB-106, 2026-09-14).** The line below was
 * added on 2026-08-30 against a CI failure of `page.goto: net::ERR_ABORTED` on the relaunch, and it
 * wrote down its own falsification condition: *"If the abort returns, the SW was not it."* It
 * returned — identically, on the initial attempt **and on Retry #1** — on PR #1166's run
 * (2026-09-14 07:11 UTC), with the block in place the whole time. The block stays only because
 * removing it in the same change that alters the relaunch would leave neither result readable; it
 * is no longer justified by the failure it was added for, and it is the next thing to drop if the
 * abort survives this.
 *
 * **`page.reload()` aborting "every run" is also no longer true** — measured here 2026-09-14,
 * reload and a same-URL `goto` both complete in the sandbox. The abort is CI-only and does not
 * reproduce locally, which is why no cause is claimed below.
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
test('a preference set on the server is seeded onto a device that has none', async ({ page, context }) => {
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

  // The fresh install: clear the keys, then **discard the running app and launch a new one**.
  //
  // This used to re-navigate the same page, and that is the line CI aborted on — the poll below was
  // never reached, so a slow launch was never the story. A new page is also the more faithful
  // reinstall: clearing storage under a live app leaves its React state, its timers and its sync
  // provider running, and that instance can write a preference key back or start a navigation of
  // its own. A reinstall is a cold process. localStorage is per-origin, so the clear carries over.
  //
  // **Whether this fixes the abort is NOT established** — it cannot be reproduced in the sandbox.
  // It removes the operation that aborted. If CI aborts again, on `fresh.goto` this time, the
  // relaunch shape was not it either, and the runner itself is the remaining suspect: the same run
  // carried a native chrome-headless-shell segfault on `plan-rescale.spec.ts`.
  await page.evaluate(() => localStorage.clear())
  await page.close()

  const fresh = await context.newPage()
  await fresh.goto('/')
  await settleRouteBoundary(fresh)

  // Seeded by `hydrateUserPreferences`, which the sync provider warms on launch — so this polls
  // rather than sampling once.
  await expect.poll(
    () => fresh.evaluate(() => ({
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
