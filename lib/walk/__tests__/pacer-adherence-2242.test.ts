// @vitest-environment jsdom
/**
 * Issue 2242 (LA-48): the walk's pacer adherence is counted live and stored per segment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import { computeWalkSegmentStats } from '@/lib/walk/segment-stats'
import { startPacerSampler, type PacerShown } from '@/lib/walk/pacer-sampler'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

const config: WalkConfig = { sets: 1, fastSec: 180, slowSec: 180, warmupSec: 60, cooldownSec: 0 }
const plan = buildIntervalPlan(config)

function begin() {
  const s = useGuidedWalkStore.getState()
  s.reset(); s.setConfig(config); s.start(Date.now())
}
const tick = (idx: number, shown: PacerShown, sec: number) =>
  useGuidedWalkStore.getState().recordPacerTick(idx, shown.signal, shown.band, sec * 1000)
const G: PacerShown = { signal: 'cadence', band: 'green' }
const R: PacerShown = { signal: 'cadence', band: 'red' }

describe('startPacerSampler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('reports what is showing once a second, and nothing for a null reading', () => {
    let shown: PacerShown | null = G
    const got: PacerShown[] = []
    const stop = startPacerSampler(() => shown, s => got.push(s))
    vi.advanceTimersByTime(3000)
    expect(got).toHaveLength(3)
    shown = null
    vi.advanceTimersByTime(2000)
    expect(got).toHaveLength(3)
    shown = R
    vi.advanceTimersByTime(1000)
    expect(got.at(-1)).toEqual(R)
    stop()
    vi.advanceTimersByTime(5000)
    expect(got).toHaveLength(4)
  })
})

describe('guided-walk store pacer tally', () => {
  beforeEach(() => { localStorage.clear(); begin() })

  it('counts a fake tick stream per band, per segment', () => {
    for (let i = 0; i < 6; i++) tick(1, G, 100 + i)
    for (let i = 0; i < 4; i++) tick(1, R, 106 + i)
    tick(2, { signal: 'hr', band: 'amber' }, 110)
    const t = useGuidedWalkStore.getState().pacerTallies
    expect(t[1].cadence).toEqual({ green: 6, amber: 0, red: 4, stopped: 0 })
    expect(t[2].hr).toEqual({ green: 0, amber: 1, red: 0, stopped: 0 })
  })

  it('a second mount reporting the same second does not double count', () => {
    tick(1, G, 100); tick(1, G, 100.4); tick(1, G, 100.9)
    expect(useGuidedWalkStore.getState().pacerTallies[1].cadence!.green).toBe(1)
    tick(1, G, 101)
    expect(useGuidedWalkStore.getState().pacerTallies[1].cadence!.green).toBe(2)
  })

  it('counts nothing once the walk is no longer active', () => {
    tick(1, G, 100)
    useGuidedWalkStore.getState().finish()
    tick(1, G, 101)
    expect(useGuidedWalkStore.getState().pacerTallies[1].cadence!.green).toBe(1)
    useGuidedWalkStore.getState().reset()
    expect(useGuidedWalkStore.getState().pacerTallies).toEqual({})
  })

  it('a new walk starts from zero', () => {
    tick(1, G, 100)
    useGuidedWalkStore.getState().start(Date.now())
    expect(useGuidedWalkStore.getState().pacerTallies).toEqual({})
    tick(1, G, 50) // an earlier clock second is fine in a new walk
    expect(useGuidedWalkStore.getState().pacerTallies[1].cadence!.green).toBe(1)
  })

  it('survives a rehydrate and resumes counting', async () => {
    for (let i = 0; i < 5; i++) tick(1, G, 100 + i)
    // The store persists on a 2 s debounce whose timer begin() already started; wait it out (real
    // time, because that timer is module-level and was armed before any fake clock).
    await new Promise(r => setTimeout(r, 2200))
    useGuidedWalkStore.setState({ pacerTallies: {}, pacerLastTickSec: null })
    await useGuidedWalkStore.persist.rehydrate()
    const s = useGuidedWalkStore.getState()
    expect(s.pacerTallies[1].cadence!.green).toBe(5)
    expect(s.pacerLastTickSec).toBe(104)
    tick(1, G, 104) // a replay of an already counted second
    tick(1, G, 105)
    expect(useGuidedWalkStore.getState().pacerTallies[1].cadence!.green).toBe(6)
  })
})

describe('computeWalkSegmentStats with a pacer tally', () => {
  const base = { plan, startedAtMs: 1_000_000, hrSamples: [], rawPoints: [], cadenceSeries: null }

  it('writes the fields on the segment the pacer judged, and omits the key elsewhere', () => {
    const stats = computeWalkSegmentStats({
      ...base,
      pacerTallies: { 1: { cadence: { green: 3, amber: 1, red: 0, stopped: 0 } } },
    })
    expect(stats[1].pacerSignal).toBe('cadence')
    expect(stats[1].pacerAdherence).toBe(0.75)
    expect(stats[1].pacerTicks).toEqual({ green: 3, amber: 1, red: 0, stopped: 0 })
    // Warm-up, and every segment of a walk saved without a tally: absent, never 0.
    expect('pacerAdherence' in stats[0]).toBe(false)
    expect('pacerSignal' in stats[2]).toBe(false)
    const none = computeWalkSegmentStats(base)
    expect(none.every(s => !('pacerAdherence' in s))).toBe(true)
  })

  it('survives the wire schema instead of being stripped, and old payloads still parse', () => {
    const segments = computeWalkSegmentStats({
      ...base,
      pacerTallies: { 1: { hr: { green: 2, amber: 0, red: 2, stopped: 1 } } },
    })
    const body = { date: '2026-08-01', activityType: 'walk', title: 'Interval walk', startTime: '08:15', durationMin: 12 }
    const res = ActivityLogBody.safeParse({ ...body, segments })
    expect(res.success).toBe(true)
    expect(res.data!.segments![1].pacerSignal).toBe('hr')
    expect(res.data!.segments![1].pacerAdherence).toBe(0.5)
    expect(res.data!.segments![1].pacerTicks).toEqual({ green: 2, amber: 0, red: 2, stopped: 1 })
    expect(res.data!.segments![0].pacerAdherence).toBeUndefined()

    const old = ActivityLogBody.safeParse({ ...body, segments: computeWalkSegmentStats(base) })
    expect(old.success).toBe(true)
    const explicitNull = ActivityLogBody.safeParse({
      ...body, segments: [{ ...segments[1], pacerSignal: null, pacerAdherence: null, pacerTicks: null }],
    })
    expect(explicitNull.success).toBe(true)
    expect(ActivityLogBody.safeParse({ ...body, segments: [{ ...segments[1], pacerAdherence: 1.5 }] }).success).toBe(false)
  })
})
