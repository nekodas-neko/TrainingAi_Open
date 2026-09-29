import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'
import type { GeneratedProgram } from '@trainingai/shared/types/builder'

/**
 * LB-187 — the AI builder's review screen is where a generated program is committed, and nothing in
 * `e2e/` reached it. `LA-183` fixed a style-less generated exercise rendering a blank sets/reps line
 * with unit tests and a source guard *because* of that, not instead of it.
 *
 * **`progressionMode` has to be Linear, and that is the whole reason this spec costs nine steps.**
 * The obvious cheap path is the default `ai` mode, where `handleGenerate` fires at step 7 and jumps
 * straight here — three inputs and four Next taps. It is useless: in `ai` mode the row's second line
 * is `formatGoalRange(...) · AI sets each phase` (`builder-review.tsx:569-572`), which never consults
 * the style at all, so a style-less exercise and a styled one render **identically** and the
 * assertion cannot fail. Only the `progressionStyleName` branch at `:573` renders the style, and only
 * outside `ai` mode. Linear also skips step 8, so the path is 1→2→3→4→5→6→7→9→10.
 *
 * **The stub must give a SIBLING a style.** `fillGeneratedStyles` infers from the program it is
 * handed, and `fill-generated-styles.test.ts` pins the case where nothing carries one: every slot
 * stays `undefined`, because there is nothing to read. A stub with no styles anywhere would render
 * blank lines and pass against the very bug this guards — the vacuous shape that bit two specs in
 * this lane already.
 *
 * The ids are arbitrary on purpose: `fillGeneratedStyles` calls `mostUsedStyleId` with the default
 * `isKnown`, which accepts every id, because a generated program's ids were already resolved
 * server-side. So this needs no `progression_styles` fixture, and it asserts the client rule only.
 */
test.use({
  storageState: STORAGE_STATE,
  // A Custom Rules check requires this wherever an `/api` route is stubbed: the service worker
  // would serve its own cached response and the stub would never be consulted.
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
})
test.setTimeout(180_000)

/** `STYLE_DISPLAY['Strength 4-set']` in `builder-review.tsx` — a real sets/reps line. */
const SETS_REPS_LINE = '4 × 5 @ 80% · 120s rest'
const STYLE_NAME = 'Strength 4-set'
const STYLE_ID = 'sty-strength-4'

const STYLELESS_EXERCISE = 'Cable Fly'

const GENERATED: GeneratedProgram = {
  name: 'LB-187 Generated',
  phaseStructureName: 'Linear Progression',
  phaseSetId: 'phase-set-lb187',
  reasoning: 'Fixture.',
  phases: [{ name: 'Accumulation', durationCycles: 4, phaseType: 'normal' }],
  sessions: [
    {
      name: 'Upper',
      icon: '💪',
      exercises: [
        // Two styled slots so there is something to infer from, then one with neither id nor name —
        // the case LA-183 is about.
        { name: 'Bench Press',  exerciseRole: 'primary',   mainMuscles: ['Chest'],   secondaryMuscles: ['Triceps'], progressionStyleName: STYLE_NAME, progressionStyleId: STYLE_ID },
        { name: 'Row',          exerciseRole: 'primary',   mainMuscles: ['Lats'],    secondaryMuscles: ['Biceps'],  progressionStyleName: STYLE_NAME, progressionStyleId: STYLE_ID },
        { name: STYLELESS_EXERCISE, exerciseRole: 'accessory', mainMuscles: ['Chest'], secondaryMuscles: [] },
      ],
    },
  ],
}

/** The wizard's footer button, which reads Next until the last question step. */
const next = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /^Next$/ })

test('a generated exercise with no style still shows a sets/reps line on the review screen', async ({ page }) => {
  await page.route(
    u => new URL(u).pathname === '/api/generate-program',
    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ program: GENERATED }) }),
  )

  await page.goto('/program', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /AI Build/ }).click()

  // 1 — a name is the only thing gating the first step.
  await expect(page.getByRole('heading', { name: 'Name your program' })).toBeVisible({ timeout: 30_000 })
  await page.getByPlaceholder('e.g. Push-Pull-Legs').fill('LB-187 Generated')
  await next(page).click()

  // 2 — equipment, which gates on at least one choice.
  await expect(page.getByRole('heading', { name: 'What equipment do you have?' })).toBeVisible()
  await page.getByRole('button', { name: 'Dumbbells', exact: true }).click()
  await next(page).click()

  // 3 and 4 advance on their defaults (3 sessions a week, 60 minutes).
  await next(page).click()
  await next(page).click()

  // 5 — a focus muscle, which gates on at least one choice.
  await expect(page.getByRole('heading', { name: 'Which muscles to focus on?' })).toBeVisible()
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  await next(page).click()

  // 6 — goal, default hypertrophy.
  await next(page).click()

  // 7 — the step this spec exists for. The default is AI Dynamic, which renders a goal range instead
  // of the style and so cannot show this defect.
  await expect(page.getByRole('heading', { name: 'Progression style' })).toBeVisible()
  await page.getByRole('button', { name: /Linear Progression/ }).click()
  await next(page).click()

  // Linear skips step 8, so this is 9 (length) then 10 (schedule) on their defaults.
  await next(page).click()
  await next(page).click()

  await page.getByRole('button', { name: /Generate Program/ }).click()

  // The review screen, reached with the stubbed program.
  const stylelessRow = page.locator('div').filter({ hasText: STYLELESS_EXERCISE }).last()
  await expect(stylelessRow).toBeVisible({ timeout: 60_000 })

  // The assertion: three exercises, three sets/reps lines. Without the fill the accessory slot
  // renders `null` there and this count is 2.
  await expect(page.getByText(SETS_REPS_LINE)).toHaveCount(3)
})
