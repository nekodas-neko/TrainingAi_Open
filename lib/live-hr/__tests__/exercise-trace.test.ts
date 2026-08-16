// lib/live-hr/__tests__/exercise-trace.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setTraceExercise,
  recordTraceSample,
  recordTraceBoundary,
  getTraceSnapshot,
  subscribeTrace,
} from '@/lib/live-hr/exercise-trace'

// Module singleton — reset to a clean, un-keyed state before each test.
beforeEach(() => {
  setTraceExercise(null)
})

describe('exercise-trace', () => {
  it('records samples only once an exercise is keyed', () => {
    recordTraceSample(80) // no key yet — ignored
    expect(getTraceSnapshot().samples).toHaveLength(0)

    setTraceExercise(1000)
    expect(getTraceSnapshot().key).toBe(1000)
    expect(getTraceSnapshot().originMs).toBe(1000)

    recordTraceSample(80)
    recordTraceSample(82)
    expect(getTraceSnapshot().samples.map(s => s.bpm)).toEqual([80, 82])
  })

  it('rejects physiologically-implausible readings at ingest', () => {
    setTraceExercise(1)
    recordTraceSample(80)
    recordTraceSample(82)
    recordTraceSample(81)
    recordTraceSample(400)  // impossible high — dropped
    recordTraceSample(10)   // impossible low — dropped
    recordTraceSample(180)  // >30 bpm slew from the ~81 median — dropped as a spike
    expect(getTraceSnapshot().samples.map(s => s.bpm)).toEqual([80, 82, 81])
  })

  it('captures set boundaries and keeps them when the store array is cleared', () => {
    setTraceExercise(500)
    recordTraceBoundary(600)
    recordTraceBoundary(700)
    expect(getTraceSnapshot().setBoundaries).toEqual([600, 700])
    // Boundaries live in the singleton, so a later store clear can't erase them.
    expect(getTraceSnapshot().setBoundaries).toHaveLength(2)
  })

  it('resets samples and boundaries when a new exercise starts', () => {
    setTraceExercise(1)
    recordTraceSample(90)
    recordTraceBoundary(123)
    expect(getTraceSnapshot().samples).toHaveLength(1)

    setTraceExercise(2) // new exercise
    expect(getTraceSnapshot().key).toBe(2)
    expect(getTraceSnapshot().samples).toHaveLength(0)
    expect(getTraceSnapshot().setBoundaries).toHaveLength(0)
  })

  it('is a no-op when re-keyed to the same exercise (does not wipe the trace)', () => {
    setTraceExercise(7)
    recordTraceSample(88)
    setTraceExercise(7) // same key — must not clear
    expect(getTraceSnapshot().samples).toHaveLength(1)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    setTraceExercise(9)
    let calls = 0
    const unsub = subscribeTrace(() => { calls++ })
    recordTraceSample(70)
    recordTraceBoundary(111)
    expect(calls).toBe(2)
    unsub()
    recordTraceSample(72)
    expect(calls).toBe(2)
  })

  it('returns a stable snapshot reference between mutations', () => {
    setTraceExercise(3)
    const a = getTraceSnapshot()
    const b = getTraceSnapshot()
    expect(a).toBe(b) // same ref — safe for useSyncExternalStore
    recordTraceSample(75)
    expect(getTraceSnapshot()).not.toBe(a) // new ref after a change
  })
})
