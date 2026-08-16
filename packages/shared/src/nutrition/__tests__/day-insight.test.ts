import { describe, it, expect } from 'vitest'
import { buildTodayInsight } from '../day-insight'

describe('buildTodayInsight', () => {
  it('summarises the drivers present today', () => {
    const s = buildTodayInsight({ batteryCurrent: 34, batteryDrained: 52,
      scales: { physicalTiredness: 5, mentalDrain: 4, barelyMoved: 1, hydration: 3, lateHeavyMeal: 5 },
      soreMuscles: ['Chest', 'Shoulders'] })
    expect(s).toContain('34')
    expect(s.toLowerCase()).toContain('late')
    expect(s.toLowerCase()).toContain('sore')
  })
  it('returns a calm message when nothing stands out', () => {
    const s = buildTodayInsight({ batteryCurrent: 78, batteryDrained: 10,
      scales: { physicalTiredness: 2, mentalDrain: 2, barelyMoved: 2, hydration: 2, lateHeavyMeal: 1 },
      soreMuscles: [] })
    expect(s.length).toBeGreaterThan(0)
    expect(s.toLowerCase()).not.toContain('late')
  })
})
