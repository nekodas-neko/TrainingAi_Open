// @vitest-environment jsdom
// #2471 (owner direction 2026-10-06): walks the ring saw are offered after the fact, once each, and
// stay answered. The live half of that test went with the phone's GPS detector (#3844).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordDetectionEvent = vi.fn()
let idSeq = 0
vi.mock('../detection-events', () => ({
  recordDetectionEvent: (...args: unknown[]) => recordDetectionEvent(...args),
  newDetectionId: () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
  flushDetectionEvents: vi.fn(async () => {}),
}))
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'

const MIN = 60_000
const WALK = { startMs: Date.UTC(2026, 9, 6, 23, 10), endMs: Date.UTC(2026, 9, 6, 23, 32), durationMin: 22 }

beforeEach(() => {
  recordDetectionEvent.mockClear()
  useAutoDetectionStore.setState({ pendingSessions: [], answeredRingWalks: [] })
})

describe('offerRingWalks', () => {
  it('offers a new walk as a route-less ring session and reports it', () => {
    useAutoDetectionStore.getState().offerRingWalks([WALK])
    const [s] = useAutoDetectionStore.getState().pendingSessions
    expect(s).toMatchObject({ ...WALK, source: 'ring', activityType: 'walk', distanceKm: 0, routePolyline: '' })
    expect(recordDetectionEvent.mock.calls.map(c => [c[1], c[2]])).toEqual([['candidate', 'ring_met'], ['offered', 'ring_met']])
  })

  it('offers each walk once, however many syncs report it', () => {
    const store = useAutoDetectionStore.getState()
    store.offerRingWalks([WALK])
    store.offerRingWalks([WALK])
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(1)
  })

  it('does not offer it again once dismissed, or once saved through the review sheet', () => {
    const store = useAutoDetectionStore.getState()
    store.offerRingWalks([WALK])
    store.dismissSession(useAutoDetectionStore.getState().pendingSessions[0].id)
    store.offerRingWalks([WALK])
    expect(useAutoDetectionStore.getState().pendingSessions).toEqual([])

    const later = { startMs: WALK.startMs + 120 * MIN, endMs: WALK.endMs + 120 * MIN, durationMin: 22 }
    store.offerRingWalks([later])
    store.removeSession(useAutoDetectionStore.getState().pendingSessions[0].id)
    store.offerRingWalks([later])
    expect(useAutoDetectionStore.getState().pendingSessions).toEqual([])
  })

  // A phone walk persisted before #3844 removed the live detector.
  it('does not double a walk the phone already recorded with a route', () => {
    useAutoDetectionStore.setState({ pendingSessions: [{
      id: 'p1', startMs: WALK.startMs + 2 * MIN, endMs: WALK.endMs, routePolyline: 'abc', distanceKm: 1.6,
      durationMin: 20, activityType: 'walk', source: 'phone',
    }] })
    useAutoDetectionStore.getState().offerRingWalks([WALK])
    expect(useAutoDetectionStore.getState().pendingSessions.map(p => p.source)).toEqual(['phone'])
  })
})
