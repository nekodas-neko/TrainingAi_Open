import { describe, it, expect } from 'vitest'
import { volumeByDayMuscle, sorenessVsVolumePoints } from '@trainingai/shared/health/soreness-volume'

const day = (d: string, muscles: string[], volume: number) => ({
  startedAt: new Date(`${d}T10:00:00.000Z`),
  exercises: [{ muscleGroups: muscles, volume }],
})

describe('volumeByDayMuscle', () => {
  it('sums per-exercise volume onto each normalized muscle for that local day', () => {
    const map = volumeByDayMuscle(
      [day('2026-07-01', ['Chest', 'Triceps'], 3000), day('2026-07-01', ['pecs'], 1000)],
      'UTC',
    )
    // 'Chest' and 'pecs' both normalize to 'chest' -> 3000 + 1000
    expect(map.get('2026-07-01|chest')).toBe(4000)
    expect(map.get('2026-07-01|triceps')).toBe(3000)
  })
})

describe('sorenessVsVolumePoints', () => {
  it('pairs a muscle-day volume with next-morning soreness as a 0/100 hit', () => {
    const sessions = [day('2026-07-01', ['Chest'], 5000), day('2026-07-02', ['Legs'], 5000)]
    const checkins = [
      { logDate: '2026-07-02', soreMuscles: ['Chest'], restingSoreness: 3 }, // chest sore next AM -> 100
      { logDate: '2026-07-03', soreMuscles: [], restingSoreness: 2 },         // legs not sore -> 0
    ]
    const points = sorenessVsVolumePoints(sessions, checkins, 'UTC')
    expect(points).toEqual([{ x: 5000, y: 100 }, { x: 5000, y: 0 }])
  })

  it('uses whole-body restingSoreness>=4 when soreMuscles is empty', () => {
    const points = sorenessVsVolumePoints(
      [day('2026-07-01', ['Back'], 4000)],
      [{ logDate: '2026-07-02', soreMuscles: [], restingSoreness: 4 }],
      'UTC',
    )
    expect(points).toEqual([{ x: 4000, y: 100 }])
  })

  it('drops a muscle-day with no morning check-in the next day', () => {
    const points = sorenessVsVolumePoints(
      [day('2026-07-01', ['Back'], 4000)],
      [], // no check-ins at all
      'UTC',
    )
    expect(points).toEqual([])
  })
})
