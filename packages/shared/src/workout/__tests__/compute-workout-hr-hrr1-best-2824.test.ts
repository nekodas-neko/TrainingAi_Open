// #2824 — the session's `hrr1_best` is the max of the set rows stored beside it, and null when no set
// has dense HR (#2601). Synthetic series only.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@trainingai/shared/health/hr-profile', () => ({
  resolveHrProfile: async () => ({ maxHr: 190, restingHr: 60, source: 'test' }),
}))

import { computeWorkoutHr } from '../compute-workout-hr'

const START = new Date('2026-03-02T02:00:00Z')
const END = new Date(START.getTime() + 40 * 60_000)
const T1 = START.getTime() + 5 * 60_000
const T2 = START.getTime() + 12 * 60_000

const setMarker = (n: number, endMs: number) => ({
  setLogId: `set-${n}`, exerciseLogId: 'ex-1', exerciseId: 'bench', exerciseName: 'Bench Press', setNumber: n,
  phaseType: null, intensityPct: null, plannedPct: null, plannedReps: null, restTakenSec: null, plannedRestSec: null,
  setStartMs: endMs - 30_000, setEndMs: endMs, loggedAt: new Date(endMs),
})

/** One reading a second at 150 bpm at each set end, falling `drop` bpm over the next 60 s. */
function strapSeries(drops: [number, number]) {
  const out: { timestamp: Date; bpm: number; source: string }[] = []
  for (let t = START.getTime(); t <= END.getTime(); t += 1_000) {
    let bpm = 100
    for (const [end, drop] of [[T1, drops[0]], [T2, drops[1]]] as const) {
      const s = (t - end) / 1_000
      if (s >= 0 && s <= 60) bpm = Math.round(150 - (drop * s) / 60)
    }
    out.push({ timestamp: new Date(t), bpm, source: 'chest_strap' })
  }
  return out
}

/** The ring's cadence: a point every five minutes, nothing near a set end. */
function ringSeries() {
  const out: { timestamp: Date; bpm: number; source: string }[] = []
  for (let t = START.getTime(); t <= END.getTime(); t += 300_000) out.push({ timestamp: new Date(t), bpm: 110, source: 'ble' })
  return out
}

function repoWith(readings: { timestamp: Date; bpm: number; source: string }[]) {
  const sets = [setMarker(1, T1), setMarker(2, T2)]
  return {
    getHrForWindow: async () => readings,
    getSetTimestampsForSession: async () => sets,
    getRrForWindow: async () => [],
    getSetDetailsForSession: async () => sets,
    getSetHrStatsSince: async () => [],
  } as unknown as Parameters<typeof computeWorkoutHr>[0]
}

describe('hrr1Best is the max of the stored set HRR60s (#2824)', () => {
  it('takes the largest of the sets', async () => {
    const out = await computeWorkoutHr(repoWith(strapSeries([30, 45])), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.setHrRows.map(r => r.hrr1Bpm)).toEqual([30, 45])
    expect(out!.summary.hrr1Best).toBe(45)
  })

  it('is the one measured set when the other cannot be seen', async () => {
    const readings = strapSeries([30, 45]).filter(r => Math.abs(r.timestamp.getTime() - (T2 + 60_000)) > 10_000)
    const out = await computeWorkoutHr(repoWith(readings), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.setHrRows.map(r => r.hrr1Bpm)).toEqual([30, null])
    expect(out!.summary.hrr1Best).toBe(30)
  })

  it('is null for a ring-only session, as every set row is', async () => {
    const out = await computeWorkoutHr(repoWith(ringSeries()), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.setHrRows.every(r => r.hrr1Bpm == null)).toBe(true)
    expect(out!.summary.hrr1Best).toBeNull()
  })
})
