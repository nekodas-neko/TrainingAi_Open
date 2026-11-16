// @vitest-environment jsdom
// #3844: the live GPS detector is gone, and a store a device persisted while it ran must still load.
import { describe, it, expect, beforeEach } from 'vitest'
import { useAutoDetectionStore } from '../auto-detection-store'

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const PHONE_WALK = {
  id: 'p1', startMs: Date.now() - 60 * 60_000, endMs: Date.now() - 40 * 60_000, routePolyline: 'abc',
  distanceKm: 1.6, durationMin: 20, activityType: 'walk', source: 'phone',
}

describe('auto-detection-store rehydration of a store persisted by the removed detector', () => {
  beforeEach(() => {
    localStorage.clear()
    useAutoDetectionStore.setState({ pendingSessions: [], answeredRingWalks: [] })
  })

  it('drops the detector\'s in-flight GPS session instead of finalizing it into a card', async () => {
    const t0 = Date.now() - 20 * 60_000
    localStorage.setItem('auto-detection-store', JSON.stringify({
      state: {
        isDetecting: true,
        sessionStartMs: t0,
        sessionPoints: [
          { lat: -27.4698, lng: 153.0251, t: t0 },
          { lat: -27.4600, lng: 153.0350, t: t0 + 10 * 60_000 },
        ],
        pendingActivityType: 'walk',
        sessionDetectionId: null,
        pendingSessions: [],
      },
      version: 0,
    }))
    await useAutoDetectionStore.persist.rehydrate()
    await flushMicrotasks()
    const state = useAutoDetectionStore.getState() as unknown as Record<string, unknown>
    expect(state.pendingSessions).toEqual([])
    for (const gone of ['isDetecting', 'sessionStartMs', 'sessionPoints', 'pendingActivityType', 'sessionDetectionId']) {
      expect(state, gone).not.toHaveProperty(gone)
    }
  })

  it('keeps a phone walk already on the card, so it can still be saved or dismissed', async () => {
    localStorage.setItem('auto-detection-store', JSON.stringify({
      state: { isDetecting: false, sessionStartMs: null, sessionPoints: [], pendingSessions: [PHONE_WALK] },
      version: 0,
    }))
    await useAutoDetectionStore.persist.rehydrate()
    const state = useAutoDetectionStore.getState()
    expect(state.pendingSessions).toEqual([PHONE_WALK])
    // Absent on a store persisted before #2471.
    expect(state.answeredRingWalks).toEqual([])
  })

  it('writes back only the offer', async () => {
    useAutoDetectionStore.getState().offerRingWalks([{ startMs: Date.now() - 30 * 60_000, endMs: Date.now() - 10 * 60_000, durationMin: 20 }])
    const written = JSON.parse(localStorage.getItem('auto-detection-store') ?? '{}') as { state: Record<string, unknown> }
    expect(Object.keys(written.state).sort()).toEqual(['answeredRingWalks', 'pendingSessions'])
  })
})
