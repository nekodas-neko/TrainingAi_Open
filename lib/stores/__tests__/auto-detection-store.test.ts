// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useAutoDetectionStore } from '../auto-detection-store'

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe('auto-detection-store rehydration resets stale isDetecting flag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resets a persisted isDetecting:true to false — no live watcher can still be running after a fresh launch', async () => {
    localStorage.setItem('auto-detection-store', JSON.stringify({
      state: {
        isDetecting: true,
        sessionStartMs: null,
        sessionPoints: [],
        pendingSessions: [],
      },
      version: 0,
    }))
    await useAutoDetectionStore.persist.rehydrate()
    const state = useAutoDetectionStore.getState()
    expect(state.isDetecting).toBe(false)
  })
})

describe('auto-detection-store rehydration finalizes a stale interrupted session', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('finalizes (does not drop) a persisted session whose last point is stale', async () => {
    const staleLastPointMs = Date.now() - 10 * 60 * 1000 // 10 min ago — well past the 3-min gap
    const sessionStartMs = staleLastPointMs - 10 * 60 * 1000 // 10-min walk
    // Enough points to pass endSession's quality gates (>= 2 points, real distance/duration).
    const sessionPoints = [
      { lat: -27.4698, lng: 153.0251, t: sessionStartMs },
      { lat: -27.4650, lng: 153.0300, t: sessionStartMs + 5 * 60 * 1000 },
      { lat: -27.4600, lng: 153.0350, t: staleLastPointMs },
    ]
    localStorage.setItem('auto-detection-store', JSON.stringify({
      state: {
        isDetecting: true,
        sessionStartMs,
        sessionPoints,
        pendingSessions: [],
      },
      version: 0,
    }))
    await useAutoDetectionStore.persist.rehydrate()
    await flushMicrotasks()
    const state = useAutoDetectionStore.getState()
    expect(state.sessionStartMs).toBeNull()
    expect(state.pendingSessions.length).toBe(1)
  })

  it('leaves a fresh in-flight session in place (e.g. a mid-walk deploy reload)', async () => {
    const freshLastPointMs = Date.now() - 30 * 1000 // 30s ago — well within the 3-min gap
    const sessionStartMs = freshLastPointMs - 5 * 60 * 1000
    const sessionPoints = [
      { lat: -27.4698, lng: 153.0251, t: sessionStartMs },
      { lat: -27.4650, lng: 153.0300, t: freshLastPointMs },
    ]
    localStorage.setItem('auto-detection-store', JSON.stringify({
      state: {
        isDetecting: true,
        sessionStartMs,
        sessionPoints,
        pendingSessions: [],
      },
      version: 0,
    }))
    await useAutoDetectionStore.persist.rehydrate()
    await flushMicrotasks()
    const state = useAutoDetectionStore.getState()
    expect(state.sessionStartMs).toBe(sessionStartMs)
    expect(state.pendingSessions.length).toBe(0)
  })
})
