import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { movementParts, movementSummary, STEP_BASELINE } from '../movement-breakdown'
import { computeActiveEnergy } from '@trainingai/shared/health/daily-energy'
import { STEP_BASELINE as SHARED_STEP_BASELINE } from '@trainingai/shared/health/energy-baseline'

/**
 * BF-87 — the breakdown under the calorie bar, and the threshold that explains a zero.
 *
 * The entry's verification is one sentence: *"the three addends shown never disagree with the
 * total."* That is not free. `activeKcal` is rounded once for display while its three parts are
 * unrounded, so rounding each part on its own produces a breakdown that does not add up — and a
 * breakdown that does not add up reads as the bug the user opened the card to investigate.
 */

const ROOT = join(__dirname, '..', '..', '..')

/** Source with comments and imports stripped, so a guard cannot pass on the prose describing it. */
const code = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '')
  .split('\n')
  .filter(l => !l.trimStart().startsWith('import '))
  .join('\n')

/**
 * Comments stripped, imports KEPT — for the one guard whose subject IS an import.
 *
 * `code()` above drops import lines so a guard cannot pass on the line that merely names the
 * symbol. Reusing it here made the opposite mistake: the "does not import the shared module" check
 * could not fail, because the import it was looking for was the first thing removed. Found by
 * mutation, which is the only thing that finds this.
 */
const codeWithImports = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '')

/**
 * The guarantee the display leans on, pinned against the producer rather than assumed.
 *
 * `computeActiveEnergy` rounds all three parts and sets `total` to their sum; the service passes
 * that `total` through as `activeKcal`, and `budgetProvenance` rounds it again (a no-op on an
 * integer). So the three numbers printed under the bar add up to the one printed above them, with
 * no apportionment needed on this side.
 *
 * **An earlier version of this file apportioned them anyway**, over 480 synthetic fractional
 * splits, guarding a case the producer cannot produce. Reading `daily-energy.ts` — which the
 * standing rule to re-verify a plan against current `main` is what prompted — showed the rounding
 * was already done upstream. This test replaces that: if Lane A ever stops rounding, or `total`
 * stops being the sum, the display's assumption breaks and this is what says so.
 */
describe('the parts the service hands us already add up', () => {
  const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }

  const cases: { name: string; input: Parameters<typeof computeActiveEnergy>[0] }[] = [
    {
      name: 'steps only, above the baseline',
      input: { profile, strengthSessions: [], activities: [], pedometerSteps: SHARED_STEP_BASELINE + 4200 },
    },
    {
      name: 'steps below the baseline earn nothing',
      input: { profile, strengthSessions: [], activities: [], pedometerSteps: 1196 },
    },
    {
      name: 'all three contributing at once',
      input: {
        profile,
        strengthSessions: [{ durationMin: 47, id: 's1', rpe: 8 }],
        activities: [{ activityType: 'cycle', durationMin: 23, distanceKm: null }],
        pedometerSteps: SHARED_STEP_BASELINE + 3311,
      },
    },
    {
      name: 'awkward durations, where rounding would show if it were ours to do',
      input: {
        profile,
        strengthSessions: [{ durationMin: 13, id: 's1' }, { durationMin: 7, id: 's2' }],
        activities: [{ activityType: 'walk', durationMin: 11, distanceKm: 1.3 }],
        pedometerSteps: SHARED_STEP_BASELINE + 1717,
      },
    },
  ]

  for (const { name, input } of cases) {
    it(name, () => {
      const r = computeActiveEnergy(input)
      for (const k of ['workoutKcal', 'activityKcal', 'stepsKcal'] as const) {
        expect(Number.isInteger(r[k]), `${k} = ${r[k]} is not an integer`).toBe(true)
      }
      expect(r.workoutKcal + r.activityKcal + r.stepsKcal).toBe(r.total)
      // Which is what the bar prints beside the parts.
      expect(Math.round(r.total)).toBe(r.total)

      const shown = movementParts(r)
      expect(shown.reduce((a, p) => a + p.kcal, 0)).toBe(r.total)
    })
  }

  it('a step count below the baseline really does earn zero', () => {
    const r = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: 1196 })
    expect(r.stepsKcal).toBe(0)
    expect(movementSummary(r)).toBe('')
  })

  it('drops the addends that contributed nothing, and keeps the rest in a fixed order', () => {
    expect(movementSummary({ workoutKcal: 320, activityKcal: 0, stepsKcal: 227 }))
      .toBe('320 workouts · 227 steps')
  })
})

describe('the threshold is quoted, never restated', () => {
  // LB-43 removed the mirror, so this pair no longer asks whether two copies agree — a re-export
  // cannot disagree with itself, and a test that cannot fail is worse than none. What it asks now
  // is whether the constant is still the shared one and still reachable from a client component.
  it('is the shared constant, not a copy of it', () => {
    expect(STEP_BASELINE).toBe(SHARED_STEP_BASELINE)
    expect(codeWithImports('components/nutrition/movement-breakdown.ts')).toMatch(/energy-baseline/)
  })

  it('does not import the shared module into the client bundle', () => {
    // The import is what broke; a comment explaining it is not, so comments go and imports stay.
    expect(codeWithImports('components/nutrition/movement-breakdown.ts')).not.toMatch(/daily-energy/)
  })

  /**
   * THE invariant now, and the one nothing else checks. `energy-baseline` is importable from a
   * client component only while it reaches no node builtin — and the reason it exists is that
   * `daily-energy` → `workout-energy` → `oura-models/constants` reaches two of them (`node:path`
   * for Q-401, `node:fs/promises` for BF-87, which took the Nutrition tab to a 500 fetching a
   * number for a line of copy). An import added to this leaf module would break the same tab
   * again, and `tsc` would say nothing.
   */
  it('the leaf module the constants live in imports nothing at all', () => {
    const src = codeWithImports('packages/shared/src/health/energy-baseline.ts')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/require\s*\(/)
  })

  it('the zero-earned line names the threshold, not just the shortfall', () => {
    const src = code('components/nutrition/calorie-zone-bar.tsx')
    expect(src).toContain('STEP_BASELINE.toLocaleString()')
    // The old copy stated the fact and withheld the reason, which is the whole report.
    expect(src).not.toContain('nothing earned from movement yet today')
  })

  it('both "calories out" explainers name it too, rather than "a baseline"', () => {
    for (const rel of ['components/nutrition/calorie-balance-bar.tsx', 'components/nutrition/energy-card.tsx']) {
      const src = code(rel)
      expect(src, rel).toContain('STEP_BASELINE.toLocaleString()')
      expect(src, rel).not.toContain('steps above a baseline')
    }
  })

  it('the bar renders the breakdown it is given', () => {
    expect(code('components/nutrition/calorie-zone-bar.tsx')).toMatch(/movementSummary\s*\(/)
  })
})
