import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-450 — `/activity` opened with no activity type used to let you record a whole activity and
 * then discard it on Save, without a word.
 *
 * The typeless state is ordinary, not exotic: `resetSession()` clears the type and runs after every
 * save and on the Pre screen's own back button, so it is where the store sits *between* activities.
 * The AI Coach's "Log an activity" handoff and the guided-walk summary's Done button both push
 * `/activity` without setting one, as does a cold open or a refresh. The old Pre screen rendered a
 * blank title field and a working Start button, and `handleSave` bailed on `!activityType` before
 * the local write, the outbox and the API fallback alike — no toast, no error, no network request,
 * `activity_logs` unchanged.
 *
 * Two things are asserted, and they fail independently:
 *   1. a typeless `/activity` shows the type picker, not a recordable Pre screen;
 *   2. picking a type still reaches a save that lands.
 *
 * **Mutation-checked**, per the Q-259 rule that a guard which cannot fail is not a guard. Reverting
 * `activity-screen.tsx` to `return <PreActivityScreen />` fails assertion 1 — the screen offers
 * Start with no type, which is exactly the reported bug. Measured, not assumed.
 *
 * What this does NOT prove: the device path. `getLocalStore` returns null outside the APK, so the
 * save here takes the `/api/activity-logs` web fallback, not the SQLite write plus outbox a real
 * user's tap takes. See `e2e/README.md`.
 */

// Cold routes compile on first use under `pnpm dev`, and this spec crosses `/activity`,
// `/api/activity-types`, `/api/activity-logs` and `/workout-select`.
test.setTimeout(180_000)

test('a typeless /activity offers a type picker instead of a recordable blank screen', async ({ page }) => {
  // The store persists to localStorage, so a previous run could leave a type set and mask exactly
  // the state under test. Cleared before the app boots rather than after, so the store rehydrates
  // from nothing — which is the real cold-open case.
  await page.addInitScript(() => window.localStorage.removeItem('ta_activity_state'))

  await page.goto('/activity')
  await settleRouteBoundary(page)

  // The picker. Before the fix this screen's entire text was "Title\nStart".
  await expect(page.getByRole('heading', { name: 'Log Activity' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('What are you doing?')).toBeVisible()

  // The bug in one assertion: nothing recordable is reachable without choosing a type first.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)

  // Deliberately a NON-distance type. Run/Hike/Cycle start a GPS watcher, which the harness has no
  // position source for — that would be testing the sandbox, not the fix.
  await page.getByRole('button', { name: 'Stretching' }).click()

  // Choosing a type hands over to the ordinary Pre screen, now correctly labelled.
  await expect(page.getByRole('heading', { name: 'Stretching' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
})

test('an activity recorded after picking a type actually saves', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem('ta_activity_state'))

  await page.goto('/activity')
  await settleRouteBoundary(page)

  await page.getByRole('button', { name: 'Stretching' }).click({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  // Must exceed 3 real seconds, and that is a finding rather than a padding constant.
  // `durationMin` is `Math.round((activeMs / 60000) * 10) / 10` (`activity-store.ts:136`), so
  // anything under 3 s rounds to **0**, and `ActivityLogBody.durationMin` is `.positive()` — the
  // POST comes back 400 and the user gets a bare "Failed to save activity". Measured: at 2 s this
  // spec failed on exactly that. Filed as Q-351; not fixed here, because the schema is Lane A's.
  await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(5_000)
  await page.getByRole('button', { name: 'Finish' }).click()

  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeVisible({ timeout: 30_000 })
  await save.click()

  // The old failure was Save doing *nothing at all* — no toast, no navigation, no request. Asserting
  // the navigation rather than the toast: `handleSave` pushes `/workout-select` only after the write
  // settles, so it cannot be reached by a save that bailed.
  await expect(page).toHaveURL(/\/workout-select/, { timeout: 60_000 })
})
