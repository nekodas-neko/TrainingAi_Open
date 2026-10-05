// BF-203a Task 7′. An estimate is the app's own guess. If the maintenance model ever learns from it,
// the loop closes on itself: estimate → maintenance → calorie target → plan target → estimate, and
// nothing outside the loop would notice the drift. So the model's inputs are pinned here.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
// The files that turn logged intake into the maintenance estimate. A path that moves must fail this
// test rather than let it pass over a file that no longer exists.
const LEARNERS = [
  'packages/shared/src/nutrition/adaptive-tdee.ts',
]
const ASSEMBLY = 'lib/health/energy-balance-service.ts'

describe('estimated meals never feed the maintenance model (BF-203a)', () => {
  for (const file of LEARNERS) {
    it(`${file} exists and does not read plan-meal answers or estimate macros`, () => {
      expect(existsSync(join(root, file)), `${file} moved: update LEARNERS`).toBe(true)
      const src = readFileSync(join(root, file), 'utf8')
      expect(src).not.toMatch(/plan_?[Mm]eal_?[Aa]nswers|PlanMealAnswer/)
      expect(src).not.toMatch(/estCalories|est_calories|estimatedKcal/)
    })
  }

  // The assembly builds today's intake AND the maintenance window from one map. An estimate may join
  // today's figure; it must never enter the map the window is read from.
  it('the energy assembly keeps estimates out of the map the maintenance window reads', () => {
    expect(existsSync(join(root, ASSEMBLY))).toBe(true)
    const src = readFileSync(join(root, ASSEMBLY), 'utf8')
    const mapLine = src.match(/const intakeByDate = [^\n]+/)?.[0]
    expect(mapLine, 'intakeByDate moved or was renamed: re-point this guard').toBeTruthy()
    expect(mapLine).not.toMatch(/est|answer/i)
    expect(src).not.toMatch(/intakeByDate\.set\(/)
  })
})
