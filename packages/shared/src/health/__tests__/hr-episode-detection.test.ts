import { describe, it, expect } from 'vitest'
import { detectWorkoutCooldownEpisode, WORKOUT_COOLDOWN_PADDING_MS, type WorkoutWindow } from '../hr-episode-detection'
import type { HrReading } from '@trainingai/shared/workout/hr-analysis'

function readings(pairs: [number, number][]): HrReading[] {
  return pairs.map(([tSec, bpm]) => ({ timestamp: new Date(tSec * 1000), bpm }))
}

// A 20-min run (0s-1200s) ramping to a peak near the end, then a clean decline through the
// 10-minute cooldown padding window.
const WORKOUT: WorkoutWindow = { startDatetime: new Date(0), endDatetime: new Date(1200_000) }

const CLEAN_RUN = readings([
  [0, 90], [300, 130], [600, 155], [900, 168], [1150, 172], [1200, 170], // effort, peak 172
  [1230, 155], [1260, 140], [1290, 128], [1320, 120],                    // +30/60/90/120s cooldown
  [1500, 105], [1700, 96],                                               // further into the padding
])

describe('detectWorkoutCooldownEpisode — clean run', () => {
  const ep = detectWorkoutCooldownEpisode(CLEAN_RUN, WORKOUT, 60)

  it('peak is the max within the effort window (not the padding)', () => {
    expect(ep!.peakBpm).toBe(172)
  })

  it('drop curve measured from bpmAtEnd (170), not from peak', () => {
    expect(ep!.drop30s).toBe(15)  // 170 - 155
    expect(ep!.drop60s).toBe(30)  // 170 - 140
    expect(ep!.drop90s).toBe(42)  // 170 - 128
    expect(ep!.drop120s).toBe(50) // 170 - 120
  })

  it('reaches resting HR (60) within the padding window', () => {
    // first reading <= 60 within (endMs, horizonEnd] -> none in this fixture (105/96 never hit 60)
    expect(ep!.recoveredResting).toBe(false)
    expect(ep!.secToResting).toBeNull()
  })

  it('carries the run_cooldown source and workout end as loggedAt', () => {
    expect(ep!.source).toBe('run_cooldown')
    expect(ep!.loggedAt).toEqual(WORKOUT.endDatetime)
  })
})

describe('detectWorkoutCooldownEpisode — recovers to resting HR', () => {
  it('recoveredResting true + secToResting set when a reading crosses the threshold', () => {
    const ep = detectWorkoutCooldownEpisode(CLEAN_RUN, WORKOUT, 100)
    // 96 at t=1700s is the first reading <= 100 after endMs (1200s) -> 500s later
    expect(ep!.recoveredResting).toBe(true)
    expect(ep!.secToResting).toBe(500)
  })
})

describe('detectWorkoutCooldownEpisode — edge cases', () => {
  it('null restingHr skips the resting-HR model but still computes the drop curve', () => {
    const ep = detectWorkoutCooldownEpisode(CLEAN_RUN, WORKOUT, null)
    expect(ep!.secToResting).toBeNull()
    expect(ep!.recoveredResting).toBeNull()
    expect(ep!.drop60s).toBe(30)
  })

  it('invalid window (end <= start) -> null', () => {
    const bad: WorkoutWindow = { startDatetime: new Date(1000), endDatetime: new Date(1000) }
    expect(detectWorkoutCooldownEpisode(CLEAN_RUN, bad, 60)).toBeNull()
  })

  it('no readings in the effort window -> null (nothing to anchor a peak on)', () => {
    const noEffort = readings([[5000, 90]]) // way outside [0, 1200]
    expect(detectWorkoutCooldownEpisode(noEffort, WORKOUT, 60)).toBeNull()
  })

  it('too few samples across the full span -> null (drop curve not trustworthy)', () => {
    const sparse = readings([[600, 150], [1200, 168]]) // only 2 samples total
    expect(detectWorkoutCooldownEpisode(sparse, WORKOUT, 60)).toBeNull()
  })

  it('a drop point with no nearby reading is null, not extrapolated', () => {
    const shortWorkout: WorkoutWindow = { startDatetime: new Date(0), endDatetime: new Date(60_000) }
    const r = readings([[0, 90], [30, 140], [60, 168], [70, 160], [80, 155], [90, 150]])
    const ep = detectWorkoutCooldownEpisode(r, shortWorkout, 60)
    expect(ep!.drop30s).toBe(18) // bpmAtEnd(168 @60s) - bpm@90s(150) — +30s from end lands at t=90
    expect(ep!.drop120s).toBeNull() // no reading anywhere near 60+120=180s in this tiny fixture
  })

  it('a reading exactly at the padding boundary is still in range', () => {
    const start = new Date(0)
    const end = new Date(100_000)
    const horizon = end.getTime() + WORKOUT_COOLDOWN_PADDING_MS
    const r = readings([
      [0, 90], [25, 120], [50, 140], [75, 155], [100, 168],
      [Math.floor(horizon / 1000), 90], // right at the edge
    ])
    const ep = detectWorkoutCooldownEpisode(r, { startDatetime: start, endDatetime: end }, null)
    expect(ep).not.toBeNull()
  })
})
