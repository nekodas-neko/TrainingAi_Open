import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../../scripts/lib/strip-comments.js'
import { KCAL_PER_KG, CALORIE_FLOOR_KCAL } from '../nutrition/tdee-adaptation'
import { DEFAULT_RESTING_HR } from '../health/hr-zones'
import { ACWR_THRESHOLDS } from '../ai-periodization/acwr'
import { DELOAD_READINESS_SOFT_MIN, DELOAD_READINESS_RECOMMENDED_MIN } from '../ai-periodization/deload-constants'

// #2375 — each of these numbers was written in two places, or outside the table that owns it.
// Comments are stripped so this file's own prose (and the explanations beside the constants) never
// satisfies or trips a guard.
const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'))

describe('one constant, one place — #2375', () => {
  it('keeps every value the consolidation moved', () => {
    // Behaviour-preserving: changing any of these is a scoring change and the owner's call.
    expect(KCAL_PER_KG).toBe(7700)
    expect(CALORIE_FLOOR_KCAL).toBe(1200)
    expect(DEFAULT_RESTING_HR).toBe(60)
    expect(ACWR_THRESHOLDS.veryLowMax).toBe(0.6)
    expect(DELOAD_READINESS_SOFT_MIN).toBe(70)
    expect(DELOAD_READINESS_RECOMMENDED_MIN).toBe(50)
  })

  it('kcal per kg and the calorie floor are not redefined', () => {
    const balance = read('packages/shared/src/nutrition/calorie-balance.ts')
    const goal = read('packages/shared/src/nutrition/goal-recommendation.ts')
    expect(balance).not.toMatch(/=\s*7700\b/)
    expect(balance).not.toMatch(/Math\.max\(\s*1200\b/)
    expect(goal).not.toMatch(/Math\.max\(\s*1200\b/)
  })

  it('the resting-HR fallback is not redefined', () => {
    for (const f of ['packages/shared/src/health/hr-profile.ts', 'packages/shared/src/running/fitness-snapshot.ts']) {
      expect(read(f)).not.toMatch(/RESTING_HR\w*\s*=\s*60\b/)
    }
  })

  it('the legacy readiness ACWR modifier reads its boundaries from the table', () => {
    expect(read('lib/health/readiness-payload.ts')).not.toMatch(/acwr\s*[<>]=?\s*0\.\d/)
  })

  it('the deload explanation and the deload decision grade readiness from the same constant', () => {
    const ui = read('app/session-select/components/deload-explanation.tsx')
    const engine = read('packages/shared/src/ai-periodization/ai-dynamic.ts')
    expect(ui).not.toMatch(/ouraReadiness\s*<\s*\d/)
    expect(ui).toContain('ouraReadiness < DELOAD_READINESS_SOFT_MIN')
    expect(engine).toContain('r >= DELOAD_READINESS_SOFT_MIN')
    expect(engine).toContain('r >= DELOAD_READINESS_RECOMMENDED_MIN')
  })
})
