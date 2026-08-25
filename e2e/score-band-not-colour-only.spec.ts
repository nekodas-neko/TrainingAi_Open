import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * Q-281 audit — of the twenty selectable Home score-ring styles, exactly one ("accentring") renders
 * a state cue at all, and it rendered it as an `aria-hidden` band-coloured dot with no text. That is
 * the repo's colour-only-state rule verbatim: `scoreBand()` colour without `scoreBand()`'s label.
 *
 * **Mutation-checked**: deleting the `{props.cue.word}` span from `oura-score-chip-row.tsx` fails
 * this spec (0 band words found); reverting the whole cue to the bare dot fails it the same way.
 * Asserting on the *word* rather than on the dot is what makes it a guard — the dot is present
 * either way.
 *
 * The style is a localStorage preference read on mount, so it is set via `addInitScript` before
 * `goto` rather than by driving the settings UI: the fix is in the chip row, and routing the spec
 * through the picker would make an unrelated screen able to break it.
 */
test.setTimeout(180_000)

test('the Home score cue renders its band word, not colour alone', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ta_score_ring_style', 'accentring')
  })
  // Home's first-open-of-day check-in is a MODAL, and Radix `aria-hidden`s `<main>` while it is
  // open — so the `getByRole` below reports an empty Home rather than a covered one. It opens after
  // an async read, which is why this spec read as *flaky* rather than broken (OR-1).
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)

  // The row hides itself entirely when every score is null, so anchor on a cell being present
  // before asserting about its cue — otherwise an empty row would pass vacuously.
  const readiness = page.getByRole('button', { name: /^Readiness: / })
  await expect(readiness).toBeVisible({ timeout: 60_000 })

  // The aria-label has always carried the band word; the bug was that nothing visible did. Read the
  // band out of the label, then require that exact word to be on screen inside the same cell.
  const label = await readiness.getAttribute('aria-label')
  const band = label?.match(/\b(High|Moderate|Low)\b/)?.[1]
  expect(band, `aria-label should name the band, got: ${label}`).toBeTruthy()

  await expect(
    readiness.getByText(band!, { exact: true }),
    'the band must be readable without relying on the dot colour',
  ).toBeVisible()
})
