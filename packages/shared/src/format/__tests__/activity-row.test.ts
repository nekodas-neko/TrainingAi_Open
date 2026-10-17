import { describe, it, expect } from 'vitest'
import { formatDateDisplay, formatTime12h } from '@trainingai/shared/date-utils'
import { activityRowText } from '@trainingai/shared/format/activity-row'

const walk = {
  date: '2026-10-14',
  startTime: '07:05',
  durationMin: 42.4,
  distanceKm: null,
  caloriesBurned: 180.6,
}

describe('activityRowText', () => {
  it('puts date, clock time and rounded minutes on the left, and rounded kcal on the right', () => {
    expect(activityRowText(walk)).toEqual({ subtitle: '14 Oct · 7:05 am · 42 min', facts: ['181 kcal'] })
  })

  it('prints distance to two decimals before kcal, and only the figures the activity has', () => {
    expect(activityRowText({ ...walk, distanceKm: 3.456 }).facts).toEqual(['3.46 km', '181 kcal'])
    expect(activityRowText({ ...walk, caloriesBurned: null }).facts).toEqual([])
    expect(activityRowText({ ...walk, distanceKm: 0, caloriesBurned: 0 }).facts).toEqual(['0.00 km', '0 kcal'])
  })

  it('drops a missing clock time or duration without leaving a separator', () => {
    expect(activityRowText({ ...walk, startTime: null, durationMin: null }).subtitle).toBe('14 Oct')
    expect(activityRowText({ ...walk, durationMin: 0 }).subtitle).toBe('14 Oct · 7:05 am')
  })

  it('reads a slash-separated date the same way', () => {
    expect(activityRowText({ ...walk, date: '2026/10/14' }).subtitle).toBe('14 Oct · 7:05 am · 42 min')
  })

  // The history card's inline text before it moved here: the move changes nothing it prints.
  it('matches the history card\'s old inline text for every combination of figures', () => {
    for (const startTime of [null, '07:05', '13:30'])
      for (const durationMin of [null, 0, 0.4, 42.5, 90])
        for (const distanceKm of [null, 0, 3.456, 10])
          for (const caloriesBurned of [null, 0, 180.5, 999.4]) {
            const log = { date: '2026-10-14', startTime, durationMin, distanceKm, caloriesBurned }
            const oldSubtitle =
              formatDateDisplay(log.date) +
              (startTime ? ` · ${formatTime12h(startTime)}` : '') +
              (durationMin ? ` · ${Math.round(durationMin)} min` : '')
            const oldFacts = [
              distanceKm != null ? `${Number(distanceKm).toFixed(2)} km` : null,
              caloriesBurned != null ? `${Math.round(caloriesBurned)} kcal` : null,
            ].filter(Boolean)
            expect(activityRowText(log)).toEqual({ subtitle: oldSubtitle, facts: oldFacts })
          }
  })
})
