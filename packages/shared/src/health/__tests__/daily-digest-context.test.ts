import { describe, it, expect } from 'vitest'
import { projectWeeklyWeightChangeKg, stepsPaceToWeeklyGoal } from '../daily-digest-context'

describe('projectWeeklyWeightChangeKg', () => {
  it('projects a weekly loss from a daily deficit', () => {
    // -500 kcal/day deficit * 7 / 7700 = -0.4545... kg/week
    expect(projectWeeklyWeightChangeKg(-500)).toBeCloseTo(-0.4545, 3)
  })
  it('projects a weekly gain from a daily surplus', () => {
    expect(projectWeeklyWeightChangeKg(300)).toBeCloseTo(0.2727, 3)
  })
  it('returns 0 for a zero delta', () => {
    expect(projectWeeklyWeightChangeKg(0)).toBe(0)
  })
})

describe('stepsPaceToWeeklyGoal', () => {
  it('computes the average daily steps needed for the rest of the week', () => {
    // 70,000 weekly target, 30,000 logged so far, 4 days left (today excluded) → 10,000/day
    expect(stepsPaceToWeeklyGoal(70_000, 30_000, 4)).toBe(10_000)
  })
  it('returns 0 when the weekly target is already met', () => {
    expect(stepsPaceToWeeklyGoal(70_000, 75_000, 3)).toBe(0)
  })
  it('returns the full remaining gap when 0 days are left (goal day is today)', () => {
    expect(stepsPaceToWeeklyGoal(70_000, 60_000, 0)).toBe(10_000)
  })
})
