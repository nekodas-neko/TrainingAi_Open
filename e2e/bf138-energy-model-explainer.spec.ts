import { test, expect } from '@playwright/test'
import { ensureEnergyBalanceProfile, STORAGE_STATE, tapInView, tolerateTestEnd } from './fixtures'

/**
 * BF-138 — the explainer has to SAY the three things, and each sits behind a guard.
 *
 * The owner asked *"I thought it was eat to 1,350 + excercise amount right? im getting confused —
 * can we have a central idea of everything"* after four screens showed four figures. The panel that
 * answers him already existed; what it did not state was the chain from his own measured resting
 * rate, the two models side by side, and which figure is actually measured rather than derived.
 *
 * **Guarded copy is the thing worth a browser test, and BF-220 is why.** That entry's pill was
 * mounted in a component which unmounts during the phase it existed for, so it could never be seen —
 * and no unit test could show it. All three paragraphs here are conditional, so each gets asserted
 * present when its guard holds and absent when it does not. A paragraph nobody can reach is the
 * same defect as no paragraph.
 *
 * The payload is overlaid rather than replaced: `EnergyCard` dereferences fields across the whole
 * response, and a thin stub takes the screen to its error state — measured on `TN-32`, where exactly
 * that cost a wrong diagnosis.
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block', viewport: { width: 412, height: 915 }, colorScheme: 'dark' })
test.setTimeout(180_000)

/**
 * **Without this the whole panel is unreachable, and the overlay cannot save it.** The route answers
 * `balance: null` plus `missingProfileFields` until the user has weight, height, date of birth and
 * sex; the seeded user is missing only the date of birth, so the card renders *"Add your date of
 * birth in Profile"* and `EnergyDetail` — which holds the explainer — never mounts. The overlay
 * deliberately passes a null balance through untouched rather than fabricating one, so it changes
 * nothing here. `fixtures.ts` records that this is the same reason `Q-402`'s fix could not be driven
 * end to end.
 */
test.beforeAll(async () => { await ensureEnergyBalanceProfile() })

/** Satisfies all three guards: a resting rate below the base, a stale saved goal, a long window. */
const SPEAKS = {
  restingRateKcal: 1325,
  restingBaseKcal: 1453,
  expenditureKcal: 1470,
  currentKcal: 1660,
  daysLogged: 29,
  weightRateKgPerWeek: 0.02,
}

/** Fails all three: no measured rate, a goal that agrees, too short a window. */
const SILENT = {
  restingRateKcal: null,
  restingBaseKcal: 1453,
  expenditureKcal: 1650,
  currentKcal: 1660,
  daysLogged: 3,
  weightRateKgPerWeek: null,
}

async function overlay(page: import('@playwright/test').Page, v: typeof SPEAKS | typeof SILENT) {
  await page.route(u => new URL(u).pathname === '/api/nutrition/energy-balance', tolerateTestEnd(async r => {
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    if (!body?.balance) return r.fulfill({ response: real })
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        balance: {
          ...body.balance,
          restingRateKcal: v.restingRateKcal,
          restingBaseKcal: v.restingBaseKcal,
          expenditureKcal: v.expenditureKcal,
        },
        target: { ...body.target, currentKcal: v.currentKcal },
        maintenance: body.maintenance && {
          ...body.maintenance,
          daysLogged: v.daysLogged,
          weightRateKgPerWeek: v.weightRateKgPerWeek,
        },
      }),
    })
  }))
}

/**
 * Open the ⓘ panel and keep it open.
 *
 * **This used to need `evaluateAll` across two matches, and `LB-189` removed the reason.** Two
 * controls carried the one accessible name *"How energy balance is calculated"* —
 * `energy-card.tsx` on Nutrition and `calorie-balance-bar.tsx` on Health — and the tab shell keeps
 * every tab's tree mounted, so both were in the DOM whichever screen you were on. A `.first()`
 * clicked the OFF-SCREEN one for 60 seconds while `aria-expanded` stayed `false`, which reads as a
 * dead button and is a mis-aimed one. They are named apart now, so the locator resolves to exactly
 * one element and `toHaveCount(1)` is the standing guard against the duplicate coming back.
 *
 * **The other two mechanisms stay, because they were never about the duplicate.** `tapInView`
 * because the control can sit below the fold, and the `toPass` loop because `showInfo` is local
 * state on a card that revalidates in the background — a remount puts the panel back to closed, so
 * one click followed by an assertion is a race.
 */
async function openInfoPanel(page: import('@playwright/test').Page): Promise<void> {
  const toggle = page.getByRole('button', { name: "How today's calorie budget is calculated" })
  await expect(toggle).toHaveCount(1, { timeout: 60_000 })
  await expect(toggle).toBeVisible()
  await expect(async () => {
    if (await toggle.getAttribute('aria-expanded') !== 'true') await tapInView(page, toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
}

const CHAIN = /measured resting rate of/
const TWO_NUMBERS = /Why two numbers/
const MEASURED = /What is actually measured/

test('with the numbers to say it, the panel states the chain, both models, and what is measured', async ({ page }) => {
  await overlay(page, SPEAKS)
  await page.goto('/nutrition', { waitUntil: 'networkidle' })

  await openInfoPanel(page)

  // ① the chain from the figure he knows to the one on screen
  await expect(page.getByText(CHAIN).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/1,325 kcal/).first()).toBeVisible()
  await expect(page.getByText(/1,453 kcal/).first()).toBeVisible()

  // ② the two models, named beside each other
  await expect(page.getByText(TWO_NUMBERS).first()).toBeVisible()
  await expect(page.getByText(/1,660 kcal/).first()).toBeVisible()

  // ③ the observation, distinguished from the estimates above it
  await expect(page.getByText(MEASURED).first()).toBeVisible()
  await expect(page.getByText(/29 logged days/).first()).toBeVisible()
})

test('⛔ and says none of them when the numbers behind them are not there', async ({ page }) => {
  await overlay(page, SILENT)
  await page.goto('/nutrition', { waitUntil: 'networkidle' })

  await openInfoPanel(page)

  // The panel is open — asserted through a line that is NOT conditional, so this cannot pass by
  // simply having failed to open it.
  await expect(page.getByText(/Calories out/).first()).toBeVisible({ timeout: 30_000 })

  for (const absent of [CHAIN, TWO_NUMBERS, MEASURED]) {
    await expect(page.getByText(absent)).toHaveCount(0)
  }
})
