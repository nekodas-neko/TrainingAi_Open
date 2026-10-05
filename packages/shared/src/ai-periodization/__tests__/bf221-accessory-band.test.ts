// BF-221. The owner was prescribed 77.5 % x 7 on a powerbuilding accessory whose band is 8-12 reps
// at 66-75 %: the model's reps were taken unchecked, and the load derived from them left the band too.
import { describe, it, expect } from 'vitest'
import { goalRange, settleAccessory } from '../goal-ranges'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const GOALS = ['strength', 'hypertrophy', 'power', 'endurance', 'powerbuilding', 'strength+hypertrophy', 'unknown-goal']

describe('settleAccessory', () => {
  it('turns the reported 7-rep powerbuilding accessory into an in-band prescription', () => {
    const band = goalRange('powerbuilding', 'accessory')
    const out = settleAccessory('powerbuilding', 7)
    expect(out.reps).toBe(8)
    expect(out.pct).toBeGreaterThanOrEqual(band.pctMin)
    expect(out.pct).toBeLessThanOrEqual(band.pctMax)
  })

  it('keeps every goal inside its band on both axes, for any rep count the model returns', () => {
    for (const goal of GOALS) {
      const band = goalRange(goal, 'accessory')
      for (const reps of [1, 3, 5, 7, band.repMin, band.repMax, 15, 25, 40]) {
        const out = settleAccessory(goal, reps)
        expect(out.reps, goal + ' ' + reps).toBeGreaterThanOrEqual(band.repMin)
        expect(out.reps, goal + ' ' + reps).toBeLessThanOrEqual(band.repMax)
        expect(out.pct, goal + ' ' + reps).toBeGreaterThanOrEqual(band.pctMin)
        expect(out.pct, goal + ' ' + reps).toBeLessThanOrEqual(band.pctMax)
      }
    }
  })

  it('leaves an in-band rep count as the model gave it', () => {
    expect(settleAccessory('powerbuilding', 10).reps).toBe(10)
    expect(settleAccessory('powerbuilding', 12).reps).toBe(12)
  })

  it('is the path the accessory branch of generation takes', () => {
    const src = readFileSync(join(__dirname, '..', 'generate-prescription.ts'), 'utf8')
    expect(src).toMatch(/const settled = settleAccessory\(signals\.trainingGoal, a\.reps\)\s*\n\s*ex\.reps = settled\.reps/)
  })
})
