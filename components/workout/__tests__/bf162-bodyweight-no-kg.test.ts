import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isBodyweightType } from '@trainingai/shared/1rm'
import { mroundStepUp, weightStepFor } from '../utils'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The card explains this bug in prose, so a raw-source match would pass on the comment. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

/**
 * BF-162 — the owner, reading his Legs prescription: *"Is this right?"*
 *
 * It was not. The card printed **`@ 85kg (66%)`** against a **Hanging Leg Raise**, an exercise with
 * no bar to load. A bodyweight `estimated_1rm` is an internal index derived from reps (BF-149), so
 * a percentage of it is not kilograms.
 *
 * `packages/shared/src/1rm.ts` states the rule in its own module comment — *"Every surface that
 * shows a stored 1RM resolves its unit here rather than hardcoding kg"* — and Q-19 applied it to the
 * card's RATIONALE while the exercise rows kept computing `oneRm × pct` unconditionally.
 */
describe('BF-162 — a bodyweight exercise shows a percent, not a weight', () => {
  it('reproduces the two numbers the owner saw, from his stored 1RMs', () => {
    // The bug was arithmetic, not an anomaly — these are the values that produced the report.
    expect(mroundStepUp(128 * 66 / 100, weightStepFor(['bodyweight']))).toBe(85)   // Hanging Leg Raise
    expect(mroundStepUp(124 * 72.5 / 100, weightStepFor(['bodyweight']))).toBe(90) // Pull-Up
  })

  it('the shared predicate is what decides, not a ninth inline string compare', () => {
    expect(isBodyweightType('bodyweight')).toBe(true)
    expect(isBodyweightType('weighted')).toBe(false)
    expect(isBodyweightType(undefined)).toBe(false)
    const card = code('components/workout/ai-prescription-card.tsx')
    expect(card).toContain('isBodyweightType')
  })

  it('the weight is suppressed by the type, and ONLY by the type', () => {
    // The guard has to sit on the weightKg computation. A guard on the render alone would still
    // compute a figure, and the next reader would wire it back into something.
    const card = code('components/workout/ai-prescription-card.tsx')
    const m = card.match(/const weightKg = ([\s\S]{0,220}?);\n/)
    expect(m, 'weightKg is no longer computed the way this test understands').toBeTruthy()
    expect(m![1]).toContain('isBodyweightType')
    expect(m![1]).toContain('oneRm != null')
  })

  it('the percent-only branch it falls through to still exists', () => {
    // The fix is to TAKE an existing branch, not to add a format. Face Pull renders this today.
    const card = code('components/workout/ai-prescription-card.tsx')
    expect(card).toMatch(/@ \$\{ex\.pct\}%/)
  })

  it('the number is not relabelled as added weight', () => {
    // 85 is 66% of a 128 index. Calling it "added" or "extra" would turn a visibly absurd number
    // into a plausible wrong one — the trap BF-158 is filed against.
    const card = code('components/workout/ai-prescription-card.tsx')
    expect(card).not.toMatch(/added\s*(weight|kg)|extra\s*kg|\+\$\{weightKg\}/i)
  })
})
