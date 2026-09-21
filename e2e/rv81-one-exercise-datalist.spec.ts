import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * RV-81 — one `<datalist>` for the exercise library, not one per exercise row.
 *
 * The list used to be rendered inside the program editor's `sess.exercises.map(...)` with a per-row
 * id, so its content — byte-identical every time — was duplicated once per exercise. At the owner's
 * production scale that is **25 exercises × 156 library rows = 3,900 `<option>` elements** against
 * 156, and because the editor's state is lifted to its parent, every keystroke in any
 * exercise-name input re-rendered the sheet and rebuilt all of them.
 *
 * **This asserts the invariant, not a speed.** Nothing here drives a Samsung WebView, so the entry
 * is explicit that the millisecond cost is unknown and filed as an element count. What the browser
 * CAN settle is that exactly one list exists, that every input points at it, and that autocomplete
 * still works — which is the whole risk of sharing an id.
 */
test.describe('RV-81 — the exercise library renders one shared datalist', () => {
  test.setTimeout(180_000)

  test('one list, every exercise input pointing at it', async ({ page }) => {
    await suppressMorningCheckin(page)
    // The editor opens straight from the URL, so this needs no navigation through the tab shell.
    await page.goto('/program?new=program')
    await settleRouteBoundary(page)

    const dialog = page.getByRole('dialog').filter({ hasText: 'New Program' })
    await expect(dialog, 'the program editor did not open').toBeVisible({ timeout: 60_000 })

    // Add a session, then several exercises — the duplication only appears with more than one row,
    // so a single-exercise editor would pass against the defect.
    await page.getByRole('button', { name: /Add Session/i }).first().click()
    const addExercise = page.getByRole('button', { name: /Add Exercise/i }).first()
    for (let i = 0; i < 3; i++) {
      await addExercise.click()
    }

    // Two separate failures, kept separate on purpose. Against the pre-fix code there is NO
    // `#ex-lib` — the ids were `ex-lib-<si>-<ei>` — and a single combined wait reported that as
    // "the library did not load", which is the wrong diagnosis for the right red.
    await expect(page.locator('datalist#ex-lib'),
      'no shared datalist — the list is still being rendered per exercise row')
      .toHaveCount(1, { timeout: 30_000 })

    // The library arrives by fetch, so an immediate read finds an empty list and every count below
    // passes trivially (0 === 0). An empty shared list would satisfy "exactly one datalist" while
    // having removed the feature.
    await page.waitForFunction(
      () => (document.querySelector('datalist#ex-lib')?.querySelectorAll('option').length ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    ).catch(() => {
      throw new Error('the shared datalist exists but never filled — exercise_library did not reach it')
    })

    const shape = await page.evaluate(() => {
      const lists = Array.from(document.querySelectorAll('datalist'))
      const inputs = Array.from(document.querySelectorAll('input[list]'))
      return {
        lists: lists.length,
        listIds: lists.map(l => l.id),
        optionsTotal: document.querySelectorAll('datalist option').length,
        optionsInFirst: lists[0]?.querySelectorAll('option').length ?? 0,
        inputs: inputs.length,
        distinctTargets: [...new Set(inputs.map(i => i.getAttribute('list')))],
      }
    })

    expect(shape.inputs, 'no exercise-name input rendered — the fixture did not add rows')
      .toBeGreaterThan(1)
    // The defect: one list per row. With N inputs there were N lists.
    expect(shape.lists, `expected one shared datalist, found ${shape.lists} (ids: ${shape.listIds})`)
      .toBe(1)
    expect(shape.distinctTargets, 'the inputs point at different lists')
      .toEqual(['ex-lib'])
    // Every option in the document belongs to the single list — no orphaned copy left behind.
    expect(shape.optionsTotal).toBe(shape.optionsInFirst)

    // Sharing an id is only equivalent if autocomplete still resolves. The browser will not open a
    // native dropdown under automation, so this asserts the binding the browser uses: the input's
    // `list` property resolves to the element, and that element carries real options.
    const bound = await page.evaluate(() => {
      const input = document.querySelector('input[list]') as HTMLInputElement | null
      const list = input?.list
      return { hasList: !!list, id: list?.id ?? null, options: list?.options.length ?? 0 }
    })
    expect(bound.hasList, 'the input\'s list no longer resolves to a datalist').toBe(true)
    expect(bound.id).toBe('ex-lib')
    expect(bound.options, 'the shared list is empty — the library did not reach it')
      .toBeGreaterThan(0)
  })
})
