import { describe, it, expect } from 'vitest'
import { buildDailyDigestText, digestHasNothing, type DigestFacts } from '../daily-digest-text'

const none = (): DigestFacts => ({ training: null, prs: [], nutrition: null, steps: null, checkin: null, phase: null })
const nutrition = (over: Partial<NonNullable<DigestFacts['nutrition']>> = {}) => ({
  kcal: 1800, budgetKcal: 2200, proteinG: 90, proteinTargetG: 150, weeklyKg: -0.36,
  loggedDays: 12, windowDays: 14, sparse: false, ...over,
})

describe('buildDailyDigestText (#3286)', () => {
  it('reports an empty day as nothing to say', () => {
    expect(digestHasNothing(none())).toBe(true)
    expect(digestHasNothing({ ...none(), checkin: { tiredness: 2, soreMuscles: [] } })).toBe(false)
  })

  it('writes a rest day on its own', () => {
    expect(buildDailyDigestText(none())).toBe('Today was a rest day, with no training logged.')
  })

  it('handles one exercise, many, and records', () => {
    const one = buildDailyDigestText({ ...none(), training: { name: 'Pull', exercises: 1, volumeKg: 950 } })
    expect(one).toBe('You trained Pull today: 1 exercise, 950 kg of volume.')
    const many = buildDailyDigestText({ ...none(), training: { name: 'Pull', exercises: 6, volumeKg: 12345.6 }, prs: ['Row 80 kg', 'Curl 30 kg', 'Pulldown 70 kg'] })
    expect(many).toContain('6 exercises, 12,346 kg of volume.')
    expect(many).toContain('New records: Row 80 kg, Curl 30 kg and Pulldown 70 kg.')
  })

  it('quotes nutrition against the budget with the weekly projection', () => {
    const text = buildDailyDigestText({ ...none(), nutrition: nutrition() })
    expect(text).toContain('You have eaten 1,800 of your 2,200 kcal budget and 90 g of 150 g protein. At today\'s rate that is -0.36 kg a week.')
    expect(text).not.toContain('days have food logged')
  })

  it('signs a surplus and drops the budget and protein target when unknown', () => {
    const text = buildDailyDigestText({ ...none(), nutrition: nutrition({ budgetKcal: null, proteinTargetG: null, weeklyKg: null }) })
    expect(text).toContain('You have eaten 1,800 kcal and 90 g protein.')
    expect(text).not.toContain('a week')
    expect(buildDailyDigestText({ ...none(), nutrition: nutrition({ weeklyKg: 0.2 }) })).toContain('+0.20 kg a week')
  })

  it('states thin logging history without advice', () => {
    const text = buildDailyDigestText({ ...none(), nutrition: nutrition({ loggedDays: 2, sparse: true }) })
    expect(text).toContain('Only 2 of the last 14 days have food logged, so one day\'s totals say little about a trend.')
    expect(text).not.toMatch(/should|aim|try to/i)
  })

  it('writes daily, weekly-with-pace and weekly-met steps', () => {
    expect(buildDailyDigestText({ ...none(), steps: { today: 7500, dailyGoal: 9000 } })).toContain('Steps: 7,500 of 9,000.')
    expect(buildDailyDigestText({ ...none(), steps: { today: 7500, weeklyTarget: 63000, pacePerDay: 8200, daysLeft: 3 } }))
      .toContain('about 8,200 a day for the rest of the week reaches your 63,000 weekly goal')
    expect(buildDailyDigestText({ ...none(), steps: { today: 7500, weeklyTarget: 63000, pacePerDay: 0, daysLeft: 3 } }))
      .toContain('your 63,000 weekly goal is already met')
  })

  it('on Sunday, with no days left, states the shortfall instead of a daily pace', () => {
    const text = buildDailyDigestText({ ...none(), steps: { today: 6000, weeklyTarget: 63000, pacePerDay: 4100, daysLeft: 0 } })
    expect(text).toContain('Steps: 6,000 today, 4,100 short of your 63,000 weekly goal, which ends today.')
    expect(text).not.toContain('rest of the week')
  })

  it('writes the check-in with either or both parts', () => {
    expect(buildDailyDigestText({ ...none(), checkin: { tiredness: 3, soreMuscles: [] } })).toContain('This morning you logged tiredness 3/5.')
    expect(buildDailyDigestText({ ...none(), checkin: { tiredness: null, soreMuscles: ['quads', 'calves'] } })).toContain('sore quads and calves')
  })

  it('counts phase sessions left, singular and last', () => {
    const f = { ...none(), training: { name: 'Pull', exercises: 3, volumeKg: 100 } }
    expect(buildDailyDigestText({ ...f, phase: { name: 'Build', cycleInPhase: 2, totalPhaseCycles: 4 } })).toContain('session 2 of 4 in the Build phase, with 2 more sessions')
    expect(buildDailyDigestText({ ...f, phase: { name: 'Build', cycleInPhase: 3, totalPhaseCycles: 4 } })).toContain('with 1 more session before')
    expect(buildDailyDigestText({ ...f, phase: { name: 'Build', cycleInPhase: 4, totalPhaseCycles: 4 } })).toContain('last session of the Build phase')
  })
})
