// LB-50 — the prompt told the model something false about its own input.
//
// It read `Baseline (Katch-McArdle, lean mass Xkg, activity level "moderate"): BMR X, TDEE X…`,
// which parses as "this TDEE was computed for a moderate activity level". It was not, and has not
// been since Q-401 deleted `ACTIVITY_MULTIPLIERS`: `calculateBaseline` computes
// `tdee = bmr * SEDENTARY_MULTIPLIER` unconditionally (goal-recommendation.ts:188), precisely so a
// self-reported level cannot double-count against the measured movement the prompt supplies
// separately. A model told otherwise can adjust for a multiplier that is not in the number.
//
// Source-level because the prompt is assembled inline in the route and the only other way to see it
// is to call an LLM. The two halves are asserted separately: the false claim is gone, AND the true
// one is stated — the absence alone would leave the model to infer it from the activity level it is
// still given on its own line.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(join(process.cwd(), 'app/api/nutrition-goals/recommend/route.ts'), 'utf8')
const model = readFileSync(join(process.cwd(), 'packages/shared/src/nutrition/goal-recommendation.ts'), 'utf8')

describe('the recommend prompt does not claim an activity-scaled TDEE (LB-50)', () => {
  // The premise, asserted rather than trusted: if a multiplier is ever reintroduced, this test
  // should fail loudly instead of quietly protecting a statement that has become false in reverse.
  it('calculateBaseline really does scale by the sedentary constant alone', () => {
    expect(model).toContain('const tdee = Math.round(bmr * SEDENTARY_MULTIPLIER)')
    expect(model).not.toMatch(/ACTIVITY_MULTIPLIERS\s*[[\]=]/)
  })

  it('the baseline line no longer names the activity level', () => {
    const baselineLines = route.split('\n').filter(l => l.includes('Baseline (') && l.includes('TDEE'))
    expect(baselineLines).toHaveLength(2)  // Katch-McArdle and Mifflin-St Jeor
    for (const line of baselineLines) {
      expect(line, 'the activity level inside the baseline parenthesis reads as "TDEE computed for this level"')
        .not.toMatch(/activity level/)
    }
  })

  it('and says outright that the TDEE is not activity-scaled', () => {
    expect(route).toMatch(/NOT scaled by the stated activity level/)
  })

  // What the level DOES reach, so the correction is not itself an overstatement.
  it('the activity level still drives the water and steps goals', () => {
    expect(model).toContain('WATER_BUMP_BY_ACTIVITY[input.activityLevel]')
    expect(model).toContain('STEP_GOAL_BY_ACTIVITY[input.activityLevel]')
  })
})
