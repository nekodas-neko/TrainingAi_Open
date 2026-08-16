import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-249, spec 2 — a write on one screen reaches the server and shows up on another.
 *
 * Spec 1 proves screens paint. This proves the app still *works*: a real control is driven, its
 * debounced PATCH is awaited, and a different tab is checked for the result. Nothing in the 466
 * vitest files covers that chain, because each link in it is mocked out somewhere different.
 *
 * It is also the guard for **Q-260** now that Q-260 is fixed: it taps through to Health without a
 * reload, which is exactly the path that used to render a stale goal.
 *
 * **This is NOT the Q-240 regression guard**, and the difference was established by mutation rather
 * than assumed. Q-240 was that `patchGoalsDebounced` invalidated nothing, so Health rendered the
 * previous goal for the whole `user-goals` TTL. Deleting that fix today
 * (`.then(res => invalidateGoalRecommendations())` in `components/profile/goals-section.tsx`)
 * leaves this spec **passing**.
 *
 * The reason is worth carrying: Health falls back to the `localStorage` device copy for the water
 * goal, target weight and target body fat whenever `userGoals` has not loaded
 * (`app/health/health-content.tsx:180-182`), and the goals UI writes that copy synchronously on
 * every keystroke. The device copy masks precisely the server-cache staleness Q-240 is about, so no
 * assertion on those three goals can ever fail. A guard that does fail needs a goal with no device
 * copy — steps, sleep or calories — plus seeded metrics for the day, since those rows only render
 * when a value exists. Filed as Q-259.
 */

/** Health renders `Goal: 2.5L` (≥1000 ml) or `Goal: 750ml`. */
function goalLabel(ml: number): string {
  return ml >= 1000 ? `Goal: ${(ml / 1000).toFixed(1)}L` : `Goal: ${ml}ml`
}

// This spec crosses three routes (`/health`, `/more`, back to `/health`) and the `/api/user/goals`
// handler, and against `pnpm dev` each of those compiles on first use. Measured on a cold server:
// the run takes 39.7 s and blows the default 45 s test budget, then passes in 7.6 s once warm — so
// without this it is a spec that only passes on its retry, which is not a passing spec.
test.setTimeout(180_000)

test('a water goal edited on More reaches the server and shows on Health', async ({ page }) => {
  // Read the current value rather than assuming a default — the seed can carry any goal, and this
  // spec also has to be safe to re-run against a database it has already written to.
  await page.goto('/health')
  await settleRouteBoundary(page)
  const goalText = page.locator('text=/^Goal: /').first()
  // Explicit budgets throughout: the config's 10 s `expect` default is a warm-server number, and
  // every wait in this spec can sit behind a first-time route or API compile.
  await expect(goalText).toBeVisible({ timeout: 60_000 })
  const before = (await goalText.innerText()).trim()

  // Pick a target that cannot collide with what is already there.
  const nextMl = before === goalLabel(3250) ? 2750 : 3250

  await page.goto('/more')
  await settleRouteBoundary(page)
  // Goals are behind a collapsible row on More, not inline on it.
  await page.getByText('Activity level, targets & AI recommendations').click()

  // `getByLabel`, not a positional xpath. The label and input were unassociated until Q-258, so this
  // used to anchor on DOM position — a brittle selector whose brittleness was the symptom. This line
  // is the test that the association exists: it fails if the htmlFor/id pairing is ever dropped.
  const input = page.getByLabel('Daily Water Goal')
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(String(nextMl))
  await input.blur()
  // The PATCH is debounced by 1 s. Waiting for the response rather than a timeout keeps this
  // deterministic — and asserting `r.ok()` means a rejected write fails here, not three lines later
  // as a confusing "Health did not update".
  await page.waitForResponse(
    r => r.url().includes('/api/user/goals') && r.request().method() === 'PATCH' && r.ok(),
    { timeout: 30_000 },
  )

  // Tap the tab — no reload. The reload that used to be here was a documented workaround for
  // Q-260, where a goal changed on More never reached Health because `user-goals` was fetched only
  // by the Progress tab's group while the water goal renders on Body, and the shell keeps every tab
  // mounted so nothing re-read it. That is fixed, so the workaround is gone: this now asserts the
  // real thing a user does, and would go red again if the fetch moved back out of the shared group.
  await page.getByRole('link', { name: 'Health' }).click()
  await settleRouteBoundary(page)
  await expect(page.locator(`text=${goalLabel(nextMl)}`).first()).toBeVisible({ timeout: 60_000 })
})
