import { describe, it, expect } from 'vitest'
import { restDayGuidance } from '@trainingai/shared/health/rest-day-guidance'

describe('restDayGuidance', () => {
  it('returns the recovered band at >=75 readiness with no soreness', () => {
    const g = restDayGuidance({ readinessScore: 80, soreMuscles: [], sleepScore: 85, consecutiveRestDays: 0 })
    expect(g.band).toBe('recovered')
    expect(g.lowConfidence).toBe(false)
  })

  it('returns the partial band at 60-74 readiness even with no soreness', () => {
    const g = restDayGuidance({ readinessScore: 65, soreMuscles: [], sleepScore: 70, consecutiveRestDays: 0 })
    expect(g.band).toBe('partial')
  })

  it('returns the partial band at >=75 readiness when localized soreness is present, naming the muscles', () => {
    const g = restDayGuidance({ readinessScore: 90, soreMuscles: ['chest', 'triceps'], sleepScore: 85, consecutiveRestDays: 0 })
    expect(g.band).toBe('partial')
    expect(g.body).toContain('chest, triceps')
    expect(g.suggestions.some(s => s.includes('chest, triceps'))).toBe(true)
  })

  it('returns the rest band below 60 readiness', () => {
    const g = restDayGuidance({ readinessScore: 40, soreMuscles: [], sleepScore: 70, consecutiveRestDays: 0 })
    expect(g.band).toBe('rest')
  })

  it('adds a low-sleep suggestion in the rest band when sleepScore is low', () => {
    // sleepScore 45 -> 35: LOW_SLEEP_SCORE was re-anchored 60 -> 42 with the 2026-08-17 Sleep Score
    // recalibration, so 45 is no longer a low night on the new scale (it sits around the owner's 9th
    // percentile boundary). 35 is unambiguously low under the recalibrated distribution.
    const g = restDayGuidance({ readinessScore: 40, soreMuscles: [], sleepScore: 35, consecutiveRestDays: 0 })
    expect(g.band).toBe('rest')
    expect(g.suggestions.some(s => s.toLowerCase().includes('sleep score was low'))).toBe(true)
  })

  it('flags lowConfidence and returns the neutral middle band when readiness data is missing', () => {
    const g = restDayGuidance({ readinessScore: null, soreMuscles: [], sleepScore: null, consecutiveRestDays: null })
    expect(g.band).toBe('partial')
    expect(g.lowConfidence).toBe(true)
  })

  it('adds a momentum suggestion in the partial band after several consecutive rest days', () => {
    const g = restDayGuidance({ readinessScore: 65, soreMuscles: [], sleepScore: 70, consecutiveRestDays: 4 })
    expect(g.suggestions.some(s => s.includes('rest days in a row'))).toBe(true)
  })
})
