import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isSplitPlan, trainingDayForPlanDate } from '../plan-variant-day'
import type { MealPlan, MealPlanDayType } from '@trainingai/shared/types/nutrition'
import type { NextSessionRecommendation, ProgramSession } from '@trainingai/shared/types/program'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * LA-184 — a split meal plan always showed its REST variant.
 *
 * `MealPlanSection` has taken `isTrainingDay?: boolean` since it was written and **no caller ever
 * passed it**, so `pickVariant` saw `undefined` every day and fell to `rest`. Confirmed by grep and
 * by `tsc`: `ActivePlanCard` is the only call site.
 */

const ROOT = path.resolve(__dirname, '../../..')
const TODAY = '2026-09-30'

const planWith = (types: MealPlanDayType[]) =>
  ({ variants: types.map(t => ({ dayType: t })) } as unknown as MealPlan)

const SESSION = { id: 's1', name: 'Session A' } as unknown as ProgramSession
const rec = (o: Partial<NextSessionRecommendation>) => o as NextSessionRecommendation

describe('LA-184 — which plan variant applies', () => {
  it('only a split plan raises the question at all', () => {
    expect(isSplitPlan(planWith(['training', 'rest']))).toBe(true)
    expect(isSplitPlan(planWith(['all']))).toBe(false)
    expect(isSplitPlan(null)).toBe(false)
    // A plan with no variants at all is not a split one — `pickVariant` falls to `variants[0]`,
    // which is the "renders something rather than nothing" path it already documents.
    expect(isSplitPlan(planWith([]))).toBe(false)
  })

  it('⭐ a scheduled session today is a training day', () => {
    expect(trainingDayForPlanDate(TODAY, TODAY, rec({ isRestDay: false, session: SESSION })))
      .toBe(true)
  })

  it('⭐ a rest day is a rest day', () => {
    expect(trainingDayForPlanDate(TODAY, TODAY, rec({ isRestDay: true }))).toBe(false)
  })

  it('⛔ `isRestDay: false` with NO session answers UNKNOWN, not "training day"', () => {
    // With no active program `getNextSession` returns exactly this — `{ isRestDay: false, reason:
    // 'No active program configured' }` — which is a claim about nothing. Reading it as a training
    // day is the trap this helper exists to avoid, and a bare `!rec.isRestDay` would have fallen in.
    expect(trainingDayForPlanDate(TODAY, TODAY, rec({ isRestDay: false }))).toBeUndefined()
  })

  it('⛔ answers UNKNOWN for any day but today, because the recommendation is only about today', () => {
    // `getNextSession(userId, timezone?)` takes no date, and the `next-session` cache key is
    // today-scoped for the same reason. Returning today's answer for another day would show the
    // wrong variant while he is looking at Tuesday — worse than the bug being fixed, because it
    // would be wrong in a way that changes with the clock.
    const today = rec({ isRestDay: false, session: SESSION })
    expect(trainingDayForPlanDate('2026-09-29', TODAY, today)).toBeUndefined()
    expect(trainingDayForPlanDate('2026-10-01', TODAY, today)).toBeUndefined()
  })

  it('answers UNKNOWN before the recommendation has loaded', () => {
    expect(trainingDayForPlanDate(TODAY, TODAY, null)).toBeUndefined()
  })

  it('and UNKNOWN reaches `pickVariant` as the REST fallback it already had — no behaviour moved', () => {
    // The guarantee that makes a today-only fix safe to ship: every case above that answers
    // `undefined` leaves `pickVariant` doing exactly what it did before this change.
    // BF-203a moved the chooser to a shared module so the estimator and the card cannot disagree.
    const src = stripComments(
      readFileSync(path.join(ROOT, 'packages/shared/src/nutrition/plan-variant.ts'), 'utf8'))
    expect(src).toMatch(/isTrainingDay \? byType\('training'\) : byType\('rest'\)/)
    const section = stripComments(
      readFileSync(path.join(ROOT, 'components/nutrition/meal-plan-section.tsx'), 'utf8'))
    expect(section).toMatch(/pickPlanVariant\(plan, isTrainingDay\)/)
  })

  it('the one caller now passes the prop, through the hook that survives the tab shell', () => {
    const src = stripComments(
      readFileSync(path.join(ROOT, 'components/nutrition/active-plan-card.tsx'), 'utf8'))
    expect(src, 'ActivePlanCard no longer passes isTrainingDay').toMatch(/isTrainingDay=\{/)
    // Not a `useEffect(() => { cachedFetch(…) }, [])`: this card is in the persistent tab shell,
    // where that shape holds its first payload until the app is killed (Q-402).
    expect(src, 'the recommendation is read with a fetch-once effect again')
      .toMatch(/useCachedValue</)
    // `next-session` is a today-scoped key at every other read site, and one variant per key.
    expect(src).toMatch(/today:\s*true/)
    expect(src).toMatch(/NEXT_SESSION_TTL/)
  })
})
