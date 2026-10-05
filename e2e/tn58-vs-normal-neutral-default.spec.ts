import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// TN-58 built this control with NO default: the absolute 1–5 above it produced two distinct values
// across 96 check-ins, none of them touched, and a neutral stored as though it were an answer is
// the defect TN-57 had just fixed.
//
// **LB-191 reversed that, by the owner's explicit call after the cost was put to him.** So this
// spec's original assertion — that nothing is selected on open - is now wrong, and the three
// properties beside it are not. It was rewritten rather than deleted, and renamed to match what it
// now asserts: the seeded value is the NEUTRAL, NULL is still reachable by retapping, and a
// DISMISSED sheet still writes nothing.
//
// That last one carries the weight the missing default used to. `day_checkins.vs_normal` has no
// column default and the sheet writes solely on Save, so closing with the X is the only remaining
// signal of "not answered" — and a later change that wrote a row on close would erase the
// distinction without touching the picker or the sheet's seed.
//
// **Deliberately does NOT call `suppressMorningCheckin`** — every other spec suppresses this sheet,
// and this one needs it. It opens when `ta_morning_checkin` is absent and the user has no `morning`
// row for today, which is what a fresh run provides. Neither test below saves, so neither leaves a
// row that would close the sheet for the other.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

// The prompt (OR-206, 2026-09-30). This is the one place the accessible-name locator lives, so a
// later wording change is one edit here rather than a hunt through the assertions.
const GROUP = 'Compared to normal'

test('the comparative control opens on the neutral, and can still be cleared to nothing', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  const group = page.getByRole('radiogroup', { name: GROUP })
  await expect(group, 'the morning check-in sheet did not open — this spec must not suppress it')
    .toBeVisible({ timeout: 20_000 })

  const options = group.getByRole('radio')
  await expect(options).toHaveCount(3)

  // The owner's decision, and the only one of the three that may be pre-selected: a seeded 'Better'
  // or 'Worse' would be a claim, where the neutral is at worst an absence of one.
  await expect(group.getByRole('radio', { name: 'About the same' }),
    'the neutral is not pre-selected — LB-191 is the owner\'s explicit call and is settled')
    .toHaveAttribute('aria-checked', 'true')
  for (const name of ['Better', 'Worse']) {
    await expect(group.getByRole('radio', { name }), `${name} is pre-selected — only the neutral may be`)
      .toHaveAttribute('aria-checked', 'false')
  }

  const better = group.getByRole('radio', { name: 'Better' })
  await better.evaluate(el => (el as HTMLElement).click())
  await expect(better).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('radio', { name: 'About the same' }),
    'the seed stayed selected alongside the tap — "one of three" is what is being asked')
    .toHaveAttribute('aria-checked', 'false')

  // Retapping returns to NOTHING selected, not to the seed. With a neutral pre-selected this is the
  // only way he can reach NULL from inside the sheet, so it matters more than it did under TN-58.
  await better.evaluate(el => (el as HTMLElement).click())
  for (const name of ['Better', 'About the same', 'Worse']) {
    await expect(group.getByRole('radio', { name }),
      `${name} is selected after the retap — NULL is no longer reachable from the control`)
      .toHaveAttribute('aria-checked', 'false')
  }
})

test('dismissing the sheet writes no row, which is now the only signal of "not answered"', async ({ page }) => {
  const writes: string[] = []
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/day-checkin') {
      writes.push(req.url())
    }
  })

  await page.goto('/', { waitUntil: 'networkidle' })

  const group = page.getByRole('radiogroup', { name: GROUP })
  await expect(group, 'the morning check-in sheet did not open — this spec must not suppress it')
    .toBeVisible({ timeout: 20_000 })
  await expect(group.getByRole('radio', { name: 'About the same' })).toHaveAttribute('aria-checked', 'true')
  expect(writes, 'the sheet wrote on OPEN, before the owner touched anything').toHaveLength(0)

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(group).toBeHidden()

  // Two anchors before "no write" means anything. The save path calls `toast.success` and fires its
  // POST in the same tick, so a save that happened would have shown the toast and been recorded;
  // `networkidle` then waits out anything slower rather than guessing at a timeout.
  await expect(page.getByText('Morning check-in saved'),
    'the dismissal ran the save path').toHaveCount(0)
  await page.waitForLoadState('networkidle')

  expect(writes, 'the seeded neutral was stored by a dismissal — "not answered" is now unreachable')
    .toHaveLength(0)
})
