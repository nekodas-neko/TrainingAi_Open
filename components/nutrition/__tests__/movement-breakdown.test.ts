import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { movementParts, movementSummary } from '../movement-breakdown'
import { computeActiveEnergy } from '@trainingai/shared/health/daily-energy'
import { STEP_BASE_CREDIT } from '@trainingai/shared/health/energy-baseline'

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
      input: { profile, strengthSessions: [], activities: [], pedometerSteps: STEP_BASE_CREDIT + 4200 },
    },
    {
      name: 'a short day, which now earns something rather than nothing',
      input: { profile, strengthSessions: [], activities: [], pedometerSteps: 1196 },
    },
    {
      name: 'all three contributing at once',
      input: {
        profile,
        strengthSessions: [{ durationMin: 47, id: 's1', rpe: 8 }],
        activities: [{ activityType: 'cycle', durationMin: 23, distanceKm: null }],
        pedometerSteps: STEP_BASE_CREDIT + 3311,
      },
    },
    {
      name: 'awkward durations, where rounding would show if it were ours to do',
      input: {
        profile,
        strengthSessions: [{ durationMin: 13, id: 's1' }, { durationMin: 7, id: 's2' }],
        activities: [{ activityType: 'walk', durationMin: 11, distanceKm: 1.3 }],
        pedometerSteps: STEP_BASE_CREDIT + 1717,
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

  /**
   * BF-88 inverted this, and the inversion is the change.
   *
   * BF-87 shipped a line explaining why 1,196 steps earned nothing; BF-88 removed the threshold that
   * made that true, crediting the same 3,000 steps' energy out of the resting base instead. The
   * summary is no longer empty at 1,196 steps, and the copy that explained the zero is gone with it.
   */
  it('a short day earns from the first step now, and says so', () => {
    const r = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: 1196 })
    expect(r.stepsKcal).toBeGreaterThan(0)
    expect(movementSummary(r)).toMatch(/steps$/)
  })

  it('an empty summary now means no movement at all, not a shortfall', () => {
    const r = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: 0 })
    expect(r.stepsKcal).toBe(0)
    expect(movementSummary(r)).toBe('')
  })

  it('drops the addends that contributed nothing, and keeps the rest in a fixed order', () => {
    expect(movementSummary({ workoutKcal: 320, activityKcal: 0, stepsKcal: 227 }))
      .toBe('320 workouts · 227 steps')
  })
})

describe('the threshold is gone, and no copy re-states it', () => {
  // BF-87 put a threshold in three sentences; BF-88 removed the threshold. What is asserted now is
  // that none of them grew it back — a stale "steps above 3,000/day" is a sentence that is simply
  // false, and the kind that survives because it still reads plausibly.
  it('no nutrition surface still promises a step threshold', () => {
    for (const rel of [
      'components/nutrition/calorie-zone-bar.tsx',
      'components/nutrition/calorie-balance-bar.tsx',
      'components/nutrition/energy-card.tsx',
      'components/nutrition/movement-breakdown.ts',
    ]) {
      expect(code(rel), rel).not.toMatch(/steps? (count |above )/i)
      expect(code(rel), rel).not.toMatch(/STEP_BASELINE/)
    }
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

  /**
   * The zero-state line survives, with a different meaning. BF-87's version explained why steps
   * existed and earned nothing; that case cannot arise any more. What remains is the honest one —
   * a day with nothing recorded at all — and it must not claim a threshold to explain itself.
   */
  it('the zero line describes an empty day rather than a shortfall', () => {
    const src = code('components/nutrition/calorie-zone-bar.tsx')
    expect(src).toContain('no movement recorded yet today')
    expect(src).not.toContain('nothing earned from movement yet today')
  })

  it('both "calories out" explainers say every step counts', () => {
    for (const rel of ['components/nutrition/calorie-balance-bar.tsx', 'components/nutrition/energy-card.tsx']) {
      const src = code(rel)
      expect(src, rel).toContain('every step you take')
      expect(src, rel).not.toContain('steps above a baseline')
    }
  })

  it('the bar renders the breakdown it is given', () => {
    expect(code('components/nutrition/calorie-zone-bar.tsx')).toMatch(/movementSummary\s*\(/)
  })
})
