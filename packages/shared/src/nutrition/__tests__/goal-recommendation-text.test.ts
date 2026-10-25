import { describe, it, expect } from 'vitest'
import { buildGoalExplanation, suggestActivityLevel, type GoalExplanationInput } from '../goal-recommendation-text'
import { calculateBaseline } from '../goal-recommendation'

const baseline = calculateBaseline({
  weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
  activityLevel: 'moderate', fitnessGoal: 'maintain', bodyFatPct: undefined, measuredRmr: null,
})
const input = (over: Partial<GoalExplanationInput> = {}): GoalExplanationInput => ({
  baseline, measuredRmr: false, fitnessGoal: 'maintain', activityLevel: 'moderate', suggestedLevel: null,
  workoutSessionCount: 6, weightDeltaKg: -0.4, bodyFatLatestPct: null, bodyFatDeltaPp: null,
  avgSteps: 8123, daysWithData: 10, personalRecordCount: 0, phase: null, ...over,
})

describe('suggestActivityLevel (#3286)', () => {
  it('upgrades sedentary and light at 4+ sessions a week (8 in 14 days)', () => {
    expect(suggestActivityLevel('sedentary', 8)).toBe('moderate')
    expect(suggestActivityLevel('light', 8)).toBe('moderate')
    expect(suggestActivityLevel('light', 7)).toBeNull()
  })
  it('never downgrades or touches a level that already fits', () => {
    expect(suggestActivityLevel('moderate', 14)).toBeNull()
    expect(suggestActivityLevel('active', 0)).toBeNull()
    expect(suggestActivityLevel('extra_active', 0)).toBeNull()
  })
  it('scales to the window length', () => {
    expect(suggestActivityLevel('light', 4, 7)).toBe('moderate')
    expect(suggestActivityLevel('light', 3, 7)).toBeNull()
  })
})

describe('buildGoalExplanation (#3286)', () => {
  it('quotes the baseline\'s own figures and the goal', () => {
    const { reasoning } = buildGoalExplanation(input())
    expect(reasoning).toContain(`resting rate of ${baseline.bmr.toLocaleString('en-US')} kcal`)
    expect(reasoning).toContain(`${baseline.calories.toLocaleString('en-US')} kcal, ${baseline.proteinG} g protein`)
    expect(reasoning).toContain('maintaining weight')
    expect(reasoning).toContain('Mifflin-St Jeor')
  })

  it('names the method: measured resting rate, or lean-mass Katch-McArdle', () => {
    expect(buildGoalExplanation(input({ measuredRmr: true })).reasoning).toContain('measured resting rate')
    const lean = { ...baseline, leanMassKg: 61.5 }
    expect(buildGoalExplanation(input({ baseline: lean })).reasoning).toContain('Katch-McArdle formula on 61.5 kg of lean mass')
  })

  it('describes the trend only when two weigh-ins exist, with body fat when logged', () => {
    expect(buildGoalExplanation(input({ weightDeltaKg: null })).reasoning).not.toContain('weight changed')
    expect(buildGoalExplanation(input({ weightDeltaKg: 0.6 })).reasoning).toContain('weight changed +0.6 kg')
    expect(buildGoalExplanation(input({ bodyFatLatestPct: 18.2, bodyFatDeltaPp: -0.5 })).reasoning).toContain('body fat is 18.2% (-0.5 pp)')
    expect(buildGoalExplanation(input({ bodyFatLatestPct: 18.2 })).reasoning).toContain('body fat is 18.2%.')
  })

  it('explains a suggested activity level from the logged sessions', () => {
    const { reasoning } = buildGoalExplanation(input({ activityLevel: 'light', suggestedLevel: 'moderate', workoutSessionCount: 9 }))
    expect(reasoning).toContain('9 sessions in 14 days (about 4.5 a week)')
    expect(reasoning).toContain('moderately active better than lightly active')
  })

  it('explains a deload or testing phase, and ignores other phases', () => {
    expect(buildGoalExplanation(input({ phase: { name: 'Reset', phaseType: 'deload' } })).reasoning).toContain('Reset phase is a deload phase')
    expect(buildGoalExplanation(input({ phase: { name: 'Build', phaseType: 'accumulation' } })).reasoning).not.toContain('Build')
  })

  it('lists insights with correct plurals, and omits absent data', () => {
    const one = buildGoalExplanation(input({ workoutSessionCount: 1, avgSteps: null, personalRecordCount: 1 })).insights
    expect(one).toBe('1 workout session in the last 14 days. 1 new personal record in this window.')
    const many = buildGoalExplanation(input({ personalRecordCount: 3 })).insights
    expect(many).toContain('6 workout sessions')
    expect(many).toContain('Average daily steps: 8,123.')
    expect(many).toContain('3 new personal records')
  })

  it('flags thin data below three days, and is quiet otherwise', () => {
    expect(buildGoalExplanation(input({ daysWithData: 0 })).dataQualityNote).toContain('Only 0 of the last 14 days')
    expect(buildGoalExplanation(input({ daysWithData: 2 })).dataQualityNote).toContain('Only 2 of the last 14 days')
    expect(buildGoalExplanation(input({ daysWithData: 3 })).dataQualityNote).toBe('')
  })
})
