import { describe, it, expect, beforeEach } from 'vitest'
import { shouldAbortInFlightDetection } from '../auto-detection-service'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { initGate, reduceGate } from '../motion-gate'

// Q-95-followup. Q-95 shipped a gate that refuses a NEW motionTrigger while a Guided Walk, a
// manual activity, or a lifting workout is running. It said nothing about a session that was
// already probing or tracking when that walk began — the shipped comment called that "a narrow,
// low-risk edge case", and it is the case the owner then hit: the "Other Activity" naming sheet
// opened by itself right as a Guided Walk finished.
//
// The item asked for a scripted-state reproduction before landing a fix. That is what the second
// describe block is: it drives the store through the exact transition and asserts on
// pendingSessions, which is what the sheet reads.

describe('shouldAbortInFlightDetection', () => {
  const idle = {
    gateIdle: true, sessionActive: false,
    workoutActive: false, guidedWalkActive: false, activityActive: false,
  }

  it('does nothing when nothing is in flight', () => {
    expect(shouldAbortInFlightDetection(idle)).toBe(false)
    expect(shouldAbortInFlightDetection({ ...idle, guidedWalkActive: true })).toBe(false)
  })

  it('does nothing when a session is in flight but no owning session exists', () => {
    // The ordinary case: a genuine unattended walk. It must survive.
    expect(shouldAbortInFlightDetection({ ...idle, gateIdle: false, sessionActive: true })).toBe(false)
  })

  it('aborts a tracking session once a guided walk is running', () => {
    expect(shouldAbortInFlightDetection({
      ...idle, gateIdle: false, sessionActive: true, guidedWalkActive: true,
    })).toBe(true)
  })

  it('aborts for a manual activity and for a lifting workout too', () => {
    expect(shouldAbortInFlightDetection({ ...idle, sessionActive: true, activityActive: true })).toBe(true)
    expect(shouldAbortInFlightDetection({ ...idle, sessionActive: true, workoutActive: true })).toBe(true)
  })

  it('aborts a probing gate that has not started a session yet', () => {
    // GPS is already burning battery for a walk the app owns; collapse it even with no session.
    expect(shouldAbortInFlightDetection({ ...idle, gateIdle: false, guidedWalkActive: true })).toBe(true)
  })

  it('aborts in ungated mode, where the gate never leaves idle but a session still accrues', () => {
    // The web/no-sensor fallback keeps GPS always-on, so gateIdle stays true and only the session
    // is evidence of anything in flight. Checking the two independently is the whole point.
    expect(shouldAbortInFlightDetection({
      ...idle, gateIdle: true, sessionActive: true, guidedWalkActive: true,
    })).toBe(true)
  })
})

describe('the reported symptom: an in-flight session finalizing into a confirm sheet', () => {
  const t0 = Date.UTC(2026, 7, 8, 9, 0, 0)
  const walkPoints = Array.from({ length: 12 }, (_, i) => ({
    // ~9 minutes, moving steadily — comfortably past the min-duration and distance floors.
    t: t0 + i * 45_000,
    lat: -27.47 + i * 0.0009,
    lng: 153.02,
  }))

  beforeEach(() => {
    useAutoDetectionStore.setState({ sessionStartMs: null, sessionPoints: [], pendingSessions: [], pendingActivityType: null })
  })

  it('endSession turns an in-flight session into a pending session — this is the popup', () => {
    const store = useAutoDetectionStore.getState()
    store.startSession(t0)
    for (const p of walkPoints) useAutoDetectionStore.getState().addPoint(p)
    useAutoDetectionStore.getState().endSession()

    // Reproduces the owner's report: the sheet reads pendingSessions.
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(1)
  })

  it('discardSession throws the same session away with no sheet', () => {
    const store = useAutoDetectionStore.getState()
    store.startSession(t0)
    for (const p of walkPoints) useAutoDetectionStore.getState().addPoint(p)
    useAutoDetectionStore.getState().discardSession()

    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(useAutoDetectionStore.getState().sessionStartMs).toBeNull()
    expect(useAutoDetectionStore.getState().sessionPoints).toHaveLength(0)
  })

  it("a discarded session cannot be resurrected by a later endSession", () => {
    const store = useAutoDetectionStore.getState()
    store.startSession(t0)
    for (const p of walkPoints) useAutoDetectionStore.getState().addPoint(p)
    useAutoDetectionStore.getState().discardSession()
    // The walk finishes and something calls endSession on the way out (the watchdog does).
    useAutoDetectionStore.getState().endSession()

    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
  })
})

describe('the gate collapses to idle on sessionEnded, whichever state it was in', () => {
  it('tracking -> idle', () => {
    const probing = reduceGate(initGate(), { type: 'motionTrigger', now: 1_000 }).ctx
    const tracking = reduceGate(probing, { type: 'sessionStarted' }).ctx
    expect(tracking.state).toBe('tracking')
    expect(reduceGate(tracking, { type: 'sessionEnded' }).ctx.state).toBe('idle')
  })

  it('probing -> idle', () => {
    const probing = reduceGate(initGate(), { type: 'motionTrigger', now: 1_000 }).ctx
    expect(reduceGate(probing, { type: 'sessionEnded' }).ctx.state).toBe('idle')
  })
})
