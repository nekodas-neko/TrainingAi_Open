import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// #2301 (LB-197) — at 384 px dark the three "Compared to normal" pills are `flex-1`, so *Better* and
// *Worse* sat on one line while *About the same* wrapped to two and set the row's height. Since
// LB-191 that is the pill pre-selected every morning, so the tall filled one was the visual anchor of
// the sheet. The owner's call (2026-10-06): all three on one line, sizing adjusted, wording kept.
//
// Measured, not eyeballed: a wrapped label makes its pill taller than its neighbours, so one line
// means the three radios share a top edge and a height, and the label is one line tall. Deliberately
// does NOT suppress the morning check-in sheet — it opens on a fresh run, as in
// tn58-vs-normal-neutral-default.spec.ts.
test.use({
  storageState: STORAGE_STATE, serviceWorkers: 'block',
  viewport: { width: 384, height: 800 }, colorScheme: 'dark',
})

test('the three comparison pills sit on one line at 384 px, wording unchanged', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  const group = page.getByRole('radiogroup', { name: 'Compared to normal' })
  await expect(group, 'the morning check-in sheet did not open — this spec must not suppress it')
    .toBeVisible({ timeout: 20_000 })

  const names = ['Better', 'About the same', 'Worse']
  const boxes = []
  for (const name of names) {
    const pill = group.getByRole('radio', { name, exact: true })
    await expect(pill, `the "${name}" wording changed — the owner asked for sizing, not rewording`).toBeVisible()
    const box = await pill.boundingBox()
    expect(box).not.toBeNull()
    boxes.push({ name, ...box! })
  }

  const tops = new Set(boxes.map(b => Math.round(b.y)))
  const heights = new Set(boxes.map(b => Math.round(b.height)))
  expect(tops.size, `the pills do not share a top edge: ${JSON.stringify(boxes)}`).toBe(1)
  expect(heights.size, `the pills are not the same height: ${JSON.stringify(boxes)}`).toBe(1)

  // And the label itself is one line: a pill can be forced to a common height by `min-h` while its
  // text still wraps, which would pass the two checks above.
  // Counted from the text's own client rects, one distinct top per rendered line. `scrollHeight`
  // would include the pill's padding and `min-h`, which is not a line count.
  const lines = await group.getByRole('radio', { name: 'About the same', exact: true }).evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top))).size
  })
  expect(lines, '"About the same" still wraps to a second line').toBe(1)

  // Nothing overflows the row sideways either — shrinking the padding must not clip the text.
  for (const name of names) {
    const clipped = await group.getByRole('radio', { name, exact: true }).evaluate(el => el.scrollWidth > el.clientWidth)
    expect(clipped, `"${name}" is clipped horizontally`).toBe(false)
  }
})
