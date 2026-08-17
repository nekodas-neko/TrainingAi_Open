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
  // `touchscreen.tap()` — a real CDP touch sequence, which is how this app is actually used —
  // rather than `.click()` or the `dispatchEvent('click')` this spec used to carry. Q-309 recorded
  // that `.click()` never opens the sheet and suspected the screen's date-swipe `useDrag` binding
  // was swallowing the tap. **Measured, and that is not what happens** (2026-08-17):
  //
  //   .click()             -> pointerdown, mousedown, pointerup, mouseup — a MOUSE sequence, no
  //                           touch events at all. Sheet does not open.
  //   touchscreen.tap()    -> pointerdown, touchstart, gotpointercapture, pointerup, touchend,
  //                           lostpointercapture, click. Sheet opens, first time, every time.
  //   dispatchEvent(click) -> opens it (the old workaround).
  //
  // So the tap path is fine and the gesture code is not implicated: the failing case never produces
  // a touch event for `filterTaps` to filter. Polling the DOM 20× over 2 s after `.click()` shows
  // the sheet never appears at all, so it is not an open-then-close either. What remains unexplained
  // is why the mouse path specifically fails on this screen when it works on `/more` — filed as
  // Q-354, and irrelevant to a touch-only product except that it made this spec lie.
  //
  // Retried because a tap fired before React has attached the handler does nothing, silently, and
  // CI starts the dev server cold. Safe here specifically: the handler is `setWaterLogOpen(true)`,
  // which is idempotent — a retried toggle would instead close the sheet again, which is how an
  // earlier version of this spec defeated itself.
  const box = (await waterRow.boundingBox())!
  await expect(async () => {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(quickAdd).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await quickAdd.click()

  // No reload, no navigation — the row itself has to move. `toPass` because the refresh is async
  // behind the write, and the point of the spec is that it lands, not how many frames it takes.
  await expect(async () => {
    expect(litresFrom(await waterRow.textContent())).toBeGreaterThan(before)
  }).toPass({ timeout: 15_000 })
})
