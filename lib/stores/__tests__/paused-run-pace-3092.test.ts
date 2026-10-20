// @vitest-environment jsdom
// #3092. A paused run's average pace used to be distance over the span from the first GPS fix to
// the last, which keeps running through the pause, so a 10-minute pause added 10 minutes to the
// pace while the saved duration left it out. The pace is now over the same active seconds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTotalDistanceKm } from '@trainingai/shared/activity/route-metrics'
import { useActivityStore } from '../activity-store'

// Local midday, clear of any date boundary.
const t0 = Date.parse('2026-10-12T12:00:00+10:00')
const metresNorth = (m: number) => -27.47 + m / 111_195

describe('a paused run saves its average pace over active time (#3092)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    useActivityStore.getState().resetSession()
  })
  afterEach(() => vi.useRealTimers())

  // 12 km/h: 6.67 m every 2 s, for `fixes` fixes from `fromM`.
  function run(fixes: number, fromM: number) {
    for (let i = 1; i <= fixes; i++) {
      vi.advanceTimersByTime(2000)
      useActivityStore.getState().appendPoint({ lat: metresNorth(fromM + i * 6.67), lng: 153.02, t: Date.now() })
    }
    return fromM + fixes * 6.67
  }

  it('leaves a 10-minute pause out of the pace, as it is left out of the duration', () => {
    const store = useActivityStore.getState()
    store.startActivity('run', 'Run', 'PersonSimpleRun', true)
    useActivityStore.getState().begin()
    const at = run(300, 0) // 10 minutes
    useActivityStore.getState().pause()
    vi.advanceTimersByTime(600_000)
    useActivityStore.getState().resume()
    run(300, at) // 10 more
    useActivityStore.getState().finish(null)
    const { draftSummary, rawPoints } = useActivityStore.getState()
    const km = computeTotalDistanceKm(rawPoints)
    expect(draftSummary!.durationMin).toBe(20)
    expect(draftSummary!.avgPaceSecPerKm).toBe(Math.round(1200 / km))
    // 12 km/h is 5:00/km; the pause would have made it 7:30.
    expect(Math.abs(draftSummary!.avgPaceSecPerKm! - 300)).toBeLessThanOrEqual(2)
  })

  it('a finish while paused ends the pause in both the duration and the pace', () => {
    useActivityStore.getState().startActivity('run', 'Run', 'PersonSimpleRun', true)
    useActivityStore.getState().begin()
    run(300, 0)
    useActivityStore.getState().pause()
    vi.advanceTimersByTime(180_000)
    useActivityStore.getState().finish(null)
    const { draftSummary, rawPoints } = useActivityStore.getState()
    expect(draftSummary!.durationMin).toBe(10)
    expect(draftSummary!.avgPaceSecPerKm).toBe(Math.round(600 / computeTotalDistanceKm(rawPoints)))
  })
})
