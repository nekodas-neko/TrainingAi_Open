import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * BF-100. A finger going down must not abandon a scroll restore that has not landed yet.
 *
 * **Why this spec exists when `scroll-restoration.spec.ts` is green.** That file drives the restore
 * with `page.goBack()`, which fires no touch at all, so it cannot see a touch-cancel either way.
 * Instrumented on `/more`, the takeover listeners attach **182 ms before** the restore lands — a real
 * window in which `done` is still false and one `touchstart` used to latch it permanently, clearing
 * the timer with no re-arm. On the S25 the system back gesture is itself a finger arriving as the new
 * screen mounts, which is the suspected device symptom; that half needs the device and BF-100 stays
 * open for it. This pins the half the harness can hold.
 *
 * **The natural window is 182 ms and cannot be hit from the test side** — three probes failed to,
 * because `page.goBack()` does not resolve until after the mount and restore, so any dispatch issued
 * after it is already too late. Seeding an offset the container can never reach widens the window to
 * the whole of `RESTORE_WINDOW_MS` instead: `attempt()` never lands, so the restore stays pending
 * until the timer fires and lands at `min(target, gap)`. That makes the touch trivially placeable
 * and the assertion binary — landed, or cancelled and sitting at 0.
 *
 * Both cases below go red against the pre-fix hook, in opposite directions: `touchstart` cancelled
 * when it should not have, and `touchmove` was not listened for at all so it failed to cancel when
 * it should have.
 */

/** Read from the hook rather than duplicated, so a change to the window cannot silently desync. */
const HOOK = 'lib/hooks/use-scroll-restoration.ts'
const RESTORE_WINDOW_MS = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', HOOK), 'utf8')
  const m = /const RESTORE_WINDOW_MS = ([\d_]+)/.exec(src)
  if (!m) throw new Error(`RESTORE_WINDOW_MS not found in ${HOOK} — this spec times itself off it`)
  return Number(m[1].replace(/_/g, ''))
})()

/** Confirmed by instrumenting `addEventListener` on a live `/more`, not guessed from the markup. */
const CONTAINER = 'div.flex-1.overflow-y-auto.pb-nav-safe.scrollbar-hide'
const SCROLL_TOP = `Math.max(0, ...[...document.querySelectorAll('*')]
  .filter(e => e.scrollTop > 0).map(e => e.scrollTop))`

/**
 * Seed a target the container cannot reach, then reload so the hook mounts and finds it pending.
 *
 * Returns the container's real scrollable range, which is where the timeout branch must land.
 */
async function armUnreachableRestore(page: Page): Promise<number> {
  await page.goto('/more')
  await page.waitForTimeout(5000)

  const gap = Number(await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? el.scrollHeight - el.clientHeight : -1
  }, CONTAINER))
  expect(gap, `no element matched ${CONTAINER} — the fixture moved, this is not a regression`)
    .toBeGreaterThan(200)

  // Far enough above the range that revalidation growing the page cannot accidentally reach it.
  await page.evaluate((target) => sessionStorage.setItem('ta_scroll:/more', String(target)), gap + 5000)
  await page.reload()
  // The hook reads the key in its mount effect; give the screen a beat to get there, while staying
  // well inside the window.
  await page.waitForTimeout(2000)
  expect(Number(await page.evaluate(SCROLL_TOP)), 'a reachable target would land immediately and prove nothing')
    .toBeLessThan(200)
  return gap
}

async function dispatchOnContainer(page: Page, type: 'touchstart' | 'touchmove') {
  const hits = Number(await page.evaluate(([sel, t]) => {
    const els = Array.from(document.querySelectorAll(sel))
    for (const el of els) el.dispatchEvent(new Event(t, { bubbles: true }))
    return els.length
  }, [CONTAINER, type] as const))
  expect(hits, `dispatched ${type} at nothing — the container selector is stale`).toBeGreaterThan(0)
}

/** Wait out the rest of the restore window, plus a margin for the timer to fire and land. */
const settle = (page: Page) => page.waitForTimeout(RESTORE_WINDOW_MS - 2000 + 4000)

test.describe('a touch during a pending scroll restore', () => {
  test.setTimeout(90_000)

  test('touchstart does not cancel it — a finger that never moved has scrolled nothing', async ({ page }) => {
    const gap = await armUnreachableRestore(page)
    await dispatchOnContainer(page, 'touchstart')
    await settle(page)

    const after = Number(await page.evaluate(SCROLL_TOP))
    expect(
      after,
      `restored to ${after} against a reachable ${gap}: 0 means a bare touchstart latched done=true and cleared the timer, which is the BF-100 cancellation`,
    ).toBeGreaterThanOrEqual(Math.round(gap * 0.9))
  })

  test('touchmove still cancels it — takeover is an input event, not a scroll delta', async ({ page }) => {
    await armUnreachableRestore(page)
    await dispatchOnContainer(page, 'touchmove')
    await settle(page)

    const after = Number(await page.evaluate(SCROLL_TOP))
    expect(
      after,
      `restored to ${after} after the user dragged: a real drag must abandon the restore, or the page yanks itself out from under them`,
    ).toBeLessThan(200)
  })
})
