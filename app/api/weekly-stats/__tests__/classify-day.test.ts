// Q-246 — owner report (Health → Training, weekly bar chart): "the deload day formatting looks
// bad. it should be normal; but maybe striped instead of colored in for the bar."
//
// A deload day was rendering as the flat grey "no data" sliver a rest day gets, because the bar's
// only input was `volume` — and `volume` deliberately excludes deload sessions so they can't
// inflate the week's headline total. Both facts are correct; the missing piece was a second field
// carrying the held-out volume, so the bar can draw a real height without touching the total.
import { describe, it, expect } from 'vitest'
import type { WorkoutSession } from '@trainingai/shared/types/log'
import { classifyDay } from '../classify-day'

function session(over: Partial<WorkoutSession> & { volume: number }): WorkoutSession {
  const { volume, ...rest } = over
  return {
    id: 'ws', userId: 'u', sessionName: 'Upper', startedAt: new Date(), completedAt: null,
    isEarlyDeload: false, phaseType: null,
    exercises: [{ volume } as WorkoutSession['exercises'][number]],
    ...rest,
  } as WorkoutSession
}

describe('classifyDay (Q-246)', () => {
  it('holds a deload day out of the counting volume but still reports what it lifted', () => {
    const d = classifyDay([session({ volume: 4000, phaseType: 'deload' })])
    expect(d.volume).toBe(0)          // must stay 0 — totalVolumeKg is summed from this
    expect(d.deloadVolume).toBe(4000) // ...and this is what the bar draws from
    expect(d.isDeload).toBe(true)
  })

  it('separates a real deload day from a rest day, which the bar could not do before', () => {
    const rest = classifyDay([])
    const deload = classifyDay([session({ volume: 4000, phaseType: 'deload' })])
    // The single fact the bug came down to: both had volume 0, so both drew the grey sliver.
    expect(rest.volume).toBe(deload.volume)
    expect(rest.deloadVolume).toBe(0)
    expect(deload.deloadVolume).toBeGreaterThan(0)
  })

  it('labels a pure testing day "T", not "D"', () => {
    // `isDeloadSession` matches phaseType 'testing' as well, so `every(isDeloadSession)` was true
    // for a testing-only day and it rendered the amber deload marker.
    const d = classifyDay([session({ volume: 2500, phaseType: 'testing' })])
    expect(d.isTesting).toBe(true)
    expect(d.isDeload).toBe(false)
    expect(d.volume).toBe(0)
    expect(d.deloadVolume).toBe(2500)
  })

  it('leaves an ordinary training day entirely alone', () => {
    const d = classifyDay([session({ volume: 9000 })])
    expect(d).toEqual({ volume: 9000, deloadVolume: 0, isDeload: false, isTesting: false })
  })

  it('counts only the normal session on a mixed day', () => {
    const d = classifyDay([session({ volume: 9000 }), session({ volume: 3000, phaseType: 'deload' })])
    expect(d.volume).toBe(9000)
    expect(d.deloadVolume).toBe(3000)
    expect(d.isDeload).toBe(false) // not every session was a deload
  })

  it('treats an early deload the same as a programmed one', () => {
    const d = classifyDay([session({ volume: 3500, isEarlyDeload: true })])
    expect(d.volume).toBe(0)
    expect(d.deloadVolume).toBe(3500)
    expect(d.isDeload).toBe(true)
  })

  it('reports a rest day as empty on every axis', () => {
    expect(classifyDay([])).toEqual({ volume: 0, deloadVolume: 0, isDeload: false, isTesting: false })
  })
})
