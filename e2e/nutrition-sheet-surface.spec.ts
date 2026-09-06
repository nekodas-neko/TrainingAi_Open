import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-75 — the nutrition sheets carry the tab's wallpaper instead of stopping it at their own edge.
 *
 * **This spec exists because the unit guards cannot see the one failure that matters.** The palette
 * is painted as an `absolute inset-0` child of `SheetContent`, which is `fixed z-50` and therefore
 * a stacking context — so without a negative z-index that child paints ABOVE the sheet's content and
 * every row of the sheet disappears behind a gradient. A source-level assertion on `-z-10` catches
 * the class going missing; only a render catches the class being wrong.
 *
 * **The wallpaper is switched ON here, and that is the whole setup.** `background-settings-store`
 * ships `enabled: false`, so in an ordinary run the layer never mounts and this spec would assert
 * nothing at all — the "passes because the feature is off" trap. Seeding the persisted key before
 * the first paint is what makes the assertions real.
 */

const STORE_KEY = 'ta_background_settings'

test.beforeEach(async ({ page }) => {
  // `addInitScript` runs before the app's own code on every navigation, so zustand's `persist`
  // rehydrates from this rather than from its defaults. Writing it after `goto` would race the
  // first render, which is exactly the moment being tested.
  await page.addInitScript(([key]) => {
    window.localStorage.setItem(key, JSON.stringify({
      state: {
        enabled: true,
        sections: { home: true, health: true, workout: true, nutrition: true, more: true },
        manualLocation: null,
      },
      version: 0,
    }))
  }, [STORE_KEY])
})

test('a nutrition sheet paints the tab palette behind its content, not over it', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still closed — this button opens Log Food, which then covers the
    // coordinate, so an unconditional re-tap lands on the sheet's own content (Q-395c).
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'My Foods', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  const content = page.locator('[data-slot="sheet-content"]').first()
  await expect(content).toBeVisible()

  // 1. The layer mounted at all. If this is 0 the wallpaper gate is wrong and the rest of the spec
  //    would pass vacuously against an ordinary opaque sheet.
  const layer = content.locator('div[aria-hidden][style*="screen-palette"]').first()
  await expect(layer, 'the palette layer must mount when the wallpaper is on').toHaveCount(1)

  // 2. It is the nutrition palette, not another screen's — the two routing functions the wallpaper
  //    and the sheet now share have to give the same answer.
  await expect(layer).toHaveAttribute('style', /--screen-palette-nutrition/)

  // 3. **The assertion this spec exists for: the layer resolves to a NEGATIVE z-index.** That is
  //    what decides paint order here — `SheetContent` is `fixed z-50` and so a stacking context, and
  //    inside it an `absolute` child with `z-index: auto` paints above the non-positioned content,
  //    covering every row of the sheet with a gradient.
  //
  //    **A hit test cannot see this, and that was measured rather than assumed.** The first version
  //    of this assertion used `document.elementFromPoint` at the centre of a tab, reasoning that a
  //    covering layer would be the topmost node there. It is not: the layer is `pointer-events-none`,
  //    so hit-testing skips it whatever its paint order — and with `-z-10` deleted the spec still
  //    passed. Reading the computed value catches the mutation and is also stronger than asserting
  //    the class, which would survive `-z-10` ceasing to be a real utility.
  //
  //    `auto` is the failing value and it parses to NaN, so this is asserted as a string first —
  //    otherwise the failure reads as a confusing `NaN < 0` rather than as "it has no z-index".
  const zIndex = await layer.evaluate(el => getComputedStyle(el).zIndex)
  expect(zIndex, 'the palette layer has no z-index, so it paints OVER the sheet content').not.toBe('auto')
  expect(Number(zIndex), 'the palette layer must sit BEHIND the sheet content').toBeLessThan(0)

  // 4. And the sheet is still usable.
  const tab = page.getByRole('tab', { name: 'My Foods', exact: true })
  await tab.tap()
  await expect(page.getByRole('tab', { name: 'My Foods', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('with the wallpaper off, the sheet is unchanged', async ({ page }) => {
  // The shipped default. A sheet painting a gradient while the page behind it is plain would be
  // worse than the opaque sheet it replaced, so "off" has to mean genuinely nothing.
  await page.addInitScript(([key]) => {
    window.localStorage.setItem(key, JSON.stringify({
      state: {
        enabled: false,
        sections: { home: true, health: true, workout: true, nutrition: true, more: true },
        manualLocation: null,
      },
      version: 0,
    }))
  }, [STORE_KEY])

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'My Foods', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  const content = page.locator('[data-slot="sheet-content"]').first()
  await expect(content).toBeVisible()
  await expect(
    content.locator('div[aria-hidden][style*="screen-palette"]'),
    'no palette layer may mount while the wallpaper is switched off',
  ).toHaveCount(0)
})
