// lib/live-hr/exercise-trace.ts
//
// Shared, in-memory HR trace for the exercise currently underway. Recorded once (by the
// workout orchestrator's 1 Hz tick) across the whole exercise — set AND rest phases — so
// the exercise-summary card can replay the full trace with per-set markers even though the
// store's set-timing arrays are cleared the instant the summary opens
// (commitExerciseSummary). The active workout card reads the same buffer but shows only the
// current rest window.
//
// Deliberately NOT in the persisted Zustand store: it's transient per-exercise state that
// must never survive a rehydration, and it updates at 1 Hz (a persist write every second
// would be wasteful). Keyed on the exercise's start timestamp so a new exercise resets it.

import { isPlausibleHrSample } from '@trainingai/shared/health/hr-smoothing'

export interface HrTraceSample { at: number; bpm: number }

export interface HrTraceSnapshot {
  /** exerciseStartMs of the exercise being traced — trace identity. null = nothing traced. */
  key: number | null
  /** Left-edge origin for the full-exercise view (== key). */
  originMs: number | null
  samples: HrTraceSample[]
  /** setEndMs per logged set — the dotted per-set boundaries on the summary chart. */
  setBoundaries: number[]
}

const MAX_SAMPLES = 5400 // 90 min at 1 Hz — plenty for one exercise

let state: HrTraceSnapshot = { key: null, originMs: null, samples: [], setBoundaries: [] }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Point the trace at a new exercise (or clear it with null). No-op if the key is unchanged. */
export function setTraceExercise(key: number | null): void {
  if (key === state.key) return
  state = { key, originMs: key, samples: [], setBoundaries: [] }
  emit()
}

/** Append a live HR reading. Physiologically-implausible spikes are dropped at ingest. */
export function recordTraceSample(bpm: number): void {
  if (state.key == null) return
  if (!isPlausibleHrSample(bpm, state.samples.slice(-8).map(s => s.bpm))) return
  const next = [...state.samples, { at: Date.now(), bpm }]
  state = { ...state, samples: next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next }
  emit()
}

/** Record a logged-set boundary (setEndMs). Recorded at log time so the later store clear
 *  can't erase it. */
export function recordTraceBoundary(endMs: number): void {
  if (state.key == null) return
  state = { ...state, setBoundaries: [...state.setBoundaries, endMs] }
  emit()
}

export function getTraceSnapshot(): HrTraceSnapshot {
  return state
}

export function subscribeTrace(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
