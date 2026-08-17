import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-297 — the first write-path spec: a logged value must appear on the screen that triggered it,
 * without a reload.
 *
 * This is CLAUDE.md's "saves feel instant" rule made executable. The log-water path writes locally
 * (or falls back to the API on web, which is what runs here), then calls back into Nutrition to
 * refresh the row. Nothing in the vitest suite covers that chain end to end — the sheet, the write
 * and the row's refresh are each mocked out somewhere different, so all three can pass while the
 * number on screen never moves.
 *
 * Deliberately asserts an **increase** rather than a value: the spec runs against a shared seeded
 * database and may run more than once, so any absolute figure would pass on the first run and fail
 * on the second. The same reasoning as the `scale-ble-day-keying` time-bomb rule — never pin one
 * side of something that moves.
 *
 * What this does NOT prove: the device path. `getLocalStore` returns null outside the APK, so the
 * web fallback (`PUT /api/body-metrics` via the sheet's catch branch) is what executes here, not the
 * SQLite write plus outbox that a real user's tap takes. See `e2e/README.md`.
 */

/** The action row renders `1.5 L`, or `—` when the day has no water logged. */
function litresFrom(label: string | null): number {
  if (!label) return 0
  const m = label.match(/([\d.]+)\s*L/)
  return m ? Number(m[1]) : 0
}

test('logging water updates the Nutrition row without a reload', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const waterRow = page.getByRole('button', { name: /water/i })
  await expect(waterRow).toBeVisible()
  const before = litresFrom(await waterRow.textContent())

  // Not scoped to `getByRole('dialog')`: the quick-add buttons are the thing being driven, and
  // scoping to the dialog role couples the spec to how the sheet primitive happens to be built.
  const quickAdd = page.getByRole('button', { name: '+250 ml' })
  // `dispatchEvent`, not `.click()`, and that is a finding rather than a convenience — see Q-309.
  // This context runs with `devices['Galaxy S9+']` (hasTouch, isMobile), so `.click()` dispatches a
  // real touch sequence. Measured: that sequence never opens the sheet — 20 s of waiting, and the
  // failure screenshot shows the plain Nutrition screen with the button untouched. A synthesised
  // `click` event, which skips the pointer sequence entirely, opens it immediately. The screen's
  // date-swipe `useDrag` binding (`pointer: { touch: true }`, `filterTaps: true`) is the obvious
  // suspect. Whether a human finger on the S25 is affected is NOT established here.
  // Retried, because a dispatched event fired before React has attached the handler does nothing
  // at all — silently — and CI starts the dev server cold, so the first visit to a route pays a
  // compile that a warm local run does not. Retrying is safe *here specifically*: the handler is
  // `setWaterLogOpen(true)`, which is idempotent. Retrying a real `.click()` would not be — that
  // toggles the sheet shut again, which is how an earlier version of this spec defeated itself.
  await expect(async () => {
    await waterRow.dispatchEvent('click')
    await expect(quickAdd).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await quickAdd.click()

  // No reload, no navigation — the row itself has to move. `toPass` because the refresh is async
  // behind the write, and the point of the spec is that it lands, not how many frames it takes.
  await expect(async () => {
    expect(litresFrom(await waterRow.textContent())).toBeGreaterThan(before)
  }).toPass({ timeout: 15_000 })
})
