import { test, expect } from '@playwright/test'
import { STORAGE_STATE, settleRouteBoundary, tapInView } from './fixtures'

/**
 * BF-67 step 3 — the engine half had no caller, and that is a browser-shaped claim.
 *
 * `/api/generate-program` has accepted `referenceProgramId` since 2026-08-31 and resolves it
 * server-side against `listPrograms(userId)`. The entry's own `Keep:` records the consequence:
 * **"Nothing reaches the owner until this ships — the parameter has no caller."** A source test can
 * show the POST names the field; only a run shows the control is reachable, that the list is
 * actually populated (it comes through `useCachedValue` off the `workout-templates` key), and that
 * the id chosen on step 1 survives six more steps into the request.
 *
 * **The generation is intercepted, never performed.** `/api/generate-program` calls Gemini, so a
 * live run would be slow, non-deterministic and would spend the route's rate limit — and what is
 * being asserted is the REQUEST, not the model's answer.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

/** Enough of a program for the review screen to mount; the model's output is not under test. */
const STUB_PROGRAM = {
  name: 'BF-67 Spec Program',
  sessions: [{ name: 'Session A', exercises: [{ name: 'Barbell Bench Press', sets: 3, reps: 8 }] }],
}

async function openWizard(page: import('@playwright/test').Page) {
  await page.goto('/program')
  await settleRouteBoundary(page)
  // ⚠ The collapsible's state is `workoutsOpen` but its HEADING READS "Programs" — a `/Workouts/i`
  // locator matches the tab bar's own nav item instead, in another tab's mounted tree, and
  // `tapInView` correctly refuses it (*"every candidate sits in an off-screen tab panel"*). Target
  // the section by its rendered text and by the `aria-expanded` it owns, not by the variable name.
  const section = page.getByRole('button', { name: 'Programs' }).first()
  await expect(section).toBeVisible({ timeout: 120_000 })
  if (await section.getAttribute('aria-expanded') !== 'true') await tapInView(page, section)
  const aiBuild = page.getByRole('button', { name: /AI Build/ })
  await expect(aiBuild).toBeVisible({ timeout: 120_000 })
  await tapInView(page, aiBuild)
  await expect(page.getByText('Name your program')).toBeVisible({ timeout: 30_000 })
}

test('⭐ the picker lists the account’s real programs on step 1', async ({ page }) => {
  await openWizard(page)

  // Populated from the `workout-templates` key, which is the half a source test cannot reach: an
  // empty list would self-hide the picker and look exactly like the feature not existing.
  await expect(page.getByText('Base it on an existing program')).toBeVisible({ timeout: 30_000 })
  const options = page.getByRole('button', { name: /^(From scratch|.+)$/ })
    .and(page.locator('[aria-pressed]'))
  expect(await options.count(), 'the picker rendered no programs beside "From scratch"')
    .toBeGreaterThan(1)

  // No reference is the default — which is what makes this safe to put on an existing step.
  const fromScratch = page.getByRole('button', { name: 'From scratch' })
  await expect(fromScratch).toHaveAttribute('aria-pressed', 'true')

  // Choosing one moves the pressed state off it, and only one is pressed at a time.
  const first = options.filter({ hasNotText: 'From scratch' }).first()
  await tapInView(page, first)
  await expect(fromScratch).toHaveAttribute('aria-pressed', 'false')
  await expect(first).toHaveAttribute('aria-pressed', 'true')
})

test('⭐ and the chosen id reaches the generator — the parameter finally has a caller', async ({ page }) => {
  // Stubbed so the model is never called, and the REQUEST is what gets read — `waitForRequest`
  // rather than waiting on the review screen, which is a second thing that could fail and is not
  // what this entry is about. (A first version asserted the review screen showed the stub's name;
  // the wizard reached step 7 and generated correctly, so that assertion was testing
  // `builder-review.tsx` against a deliberately minimal program.)
  await page.route('**/api/generate-program', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ program: STUB_PROGRAM }),
  }))

  await openWizard(page)

  await page.getByPlaceholder('e.g. Push-Pull-Legs').fill('BF-67 Spec Program')
  const chosen = page.locator('[aria-pressed]').filter({ hasNotText: 'From scratch' }).first()
  const chosenName = (await chosen.innerText()).split('\n')[0]
  await tapInView(page, chosen)
  await expect(chosen, `"${chosenName}" did not take the selection`)
    .toHaveAttribute('aria-pressed', 'true')

  // Step 2 wants equipment, step 5 wants a muscle; 3, 4, 6 and 7 carry defaults. AI Dynamic is the
  // default progression mode, so step 7 is the last question and its button generates.
  //
  // ⚠ **Step 3 is a `WeightDial`, and `tapInView` scrolls.** Scrolling the Next button into view
  // over a scroll-wheel moves it, so the request below carries `sessionsPerWeek: 1` rather than the
  // default 3. Harmless here — this spec asserts the REFERENCE, and the dial's floor is 1, so
  // `canAdvance` cannot be starved — but it is not an incidental detail either: a scroll-based tap
  // helper mutates any scroll-wheel control it passes. A spec that cared about the value would have
  // to set it explicitly after the last scroll, not before.
  const next = page.getByRole('button', { name: /^Next/ })
  await tapInView(page, next)
  await tapInView(page, page.getByRole('button', { name: 'Dumbbells' }))
  for (let i = 0; i < 3; i++) await tapInView(page, next)
  await tapInView(page, page.getByRole('button', { name: 'Chest', exact: true }))
  await tapInView(page, next)
  await tapInView(page, next)
  const request = page.waitForRequest('**/api/generate-program', { timeout: 60_000 })
  await tapInView(page, page.getByRole('button', { name: /Generate Program/ }))

  // The assertion this entry exists for.
  const sent = (await request).postDataJSON() as Record<string, unknown>
  expect(typeof sent.referenceProgramId, `body was ${JSON.stringify(sent).slice(0, 200)}`)
    .toBe('string')
  // An ID, never a program object — the route's own rule, asserted on the wire rather than in the
  // source. The reference's STRUCTURE must not be in this body at all: the route reads it
  // server-side under the user's own scope, and accepting it from here would be an ownership hole
  // and a prompt-injection surface for nothing the id does not already give.
  expect(sent.referenceProgramId).toMatch(/^[0-9a-f-]{36}$/)
  expect(sent).not.toHaveProperty('referenceProgram')
  expect(Object.keys(sent), 'a program structure rode along with the id')
    .not.toContain('sessions')
  expect(JSON.stringify(sent), 'a session or exercise list reached the request body')
    .not.toMatch(/"(sessions|exercises|sessionExercises)"\s*:/)
})
