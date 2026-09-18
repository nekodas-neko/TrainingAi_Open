import { test, expect, type Page } from '@playwright/test'
import { WALK_PATTERNS } from '@trainingai/shared/walking/recommend-walk-pattern'
import { settleRouteBoundary, suppressMorningCheckin, tapInView } from './fixtures'

/**
 * TN-25 — the guided walk's block structure is prescribed, not picked.
 *
 * The owner: *"I'd like the fast/slow rates to be varying and assigned to me."* `recommendWalkPattern`
 * shipped in #1262 and **had no caller at all**, so the pattern was never actually assigned — the
 * screen still opened on whichever preset was last used.
 *
 * **This asserts the wiring, not the arithmetic.** Which sets/fast/slow each pattern maps to is
 * pinned by `lib/walk/__tests__/walk-pattern-config.test.ts`; that unit test would still pass if
 * nothing on screen ever read it. This one checks the prescription reaches the steppers the walk
 * actually runs from, and it deliberately does not hardcode WHICH pattern — that depends on the
 * seeded week's Zone-2 gap, and a spec that pinned it would be testing the fixture.
 *
 * The second half is the hazard the entry named: `walk-config.tsx` autosaves `customConfig` on
 * every config change, so a prescription applied on open could silently overwrite the walker's own
 * saved setup. Editing, reloading and swiping back to Custom is the only way to see that from
 * outside.
 */

const PATTERN_LABELS = Object.values(WALK_PATTERNS).map(p => p.label)
/** The store persists through a 2s debounce; a reload before it fires would lose the edit. */
const PERSIST_SETTLE_MS = 2600

function field(page: Page, label: string) {
  return page.locator('label').filter({ hasText: label }).locator('span.tabular-nums').first()
}

async function readConfig(page: Page) {
  return {
    sets: Number(await field(page, 'Sets').innerText()),
    fastMin: Number(await field(page, 'Fast (min)').innerText()),
    slowMin: Number(await field(page, 'Slow (min)').innerText()),
  }
}

async function openWalk(page: Page) {
  await suppressMorningCheckin(page)
  await page.goto('/activity/guided-walk')
  await settleRouteBoundary(page)
  // The prescription lands with the cardio-week fetch, and selecting Today is how it announces
  // itself — waiting on the dot rather than on a timeout.
  await expect(page.locator('[aria-label="Today"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
}

test('today’s walk is prescribed on open, and the steppers run what the slide promises', async ({ page }) => {
  await openWalk(page)

  const slide = page.locator('text=/min total/').first()
  const promised = await slide.innerText()
  expect(promised, 'the Today slide never filled in — it is still showing the placeholder')
    .toMatch(/min total/)

  // The slide names one of the four owner-approved patterns, not the placeholder or a preset name.
  const heading = page.locator('.text-2xl.font-black').first()
  await expect(heading).toHaveText(new RegExp(PATTERN_LABELS.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')))

  const shown = await readConfig(page)
  if (/continuous/.test(promised)) {
    // One block: exactly one of the two halves is the whole session, the other is zero.
    expect(shown.sets).toBe(1)
    expect(Math.min(shown.fastMin, shown.slowMin)).toBe(0)
    expect(Math.max(shown.fastMin, shown.slowMin)).toBeGreaterThan(0)
  } else {
    const m = promised.match(/(\d+)×(\d+)\/(\d+)\s*min/)
    expect(m, `could not read the structure out of "${promised}"`).not.toBeNull()
    expect(shown).toEqual({ sets: Number(m![1]), fastMin: Number(m![2]), slowMin: Number(m![3]) })
  }
})

test('the prescription does not eat the walker’s saved Custom setup', async ({ page }) => {
  await openWalk(page)
  const prescribed = await readConfig(page)

  // Nudge a stepper. That flips the carousel to Custom and saves the edit as the Custom preset —
  // which is exactly what an auto-applied prescription could otherwise overwrite on next open.
  await tapInView(page, page.locator('[aria-label="increase Sets"]'))
  await expect(page.locator('[aria-label="Custom"]')).toHaveAttribute('aria-pressed', 'true')
  const mine = await readConfig(page)
  expect(mine.sets, 'the stepper did not move').toBe(prescribed.sets + 1)
  await page.waitForTimeout(PERSIST_SETTLE_MS)

  await openWalk(page)
  expect(await readConfig(page), 'the prescription should reassert itself on a fresh open').toEqual(prescribed)

  await tapInView(page, page.locator('[aria-label="Custom"]'))
  expect(
    await readConfig(page),
    'the saved Custom setup was destroyed by the prescription being applied over it',
  ).toEqual(mine)
})
