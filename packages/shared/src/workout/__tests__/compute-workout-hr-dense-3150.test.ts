// #3150 — `computeWorkoutHr` judges density over the session's own span, start to end: the 10-minute
// pads either side count towards the averages but not towards the verdict, as in the calorie gate.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@trainingai/shared/health/hr-profile', () => ({
  resolveHrProfile: async () => ({ maxHr: 190, restingHr: 60, source: 'test' }),
}))

import { computeWorkoutHr } from '../compute-workout-hr'

const START = new Date('2026-03-02T02:00:00Z')
const END = new Date(START.getTime() + 40 * 60_000)
const MIN = 60_000

function repoWith(readings: { timestamp: Date; bpm: number; source: string }[]) {
  return {
    getHrForWindow: async () => readings,
    getSetTimestampsForSession: async () => [],
    getRrForWindow: async () => [],
    getSetDetailsForSession: async () => [],
    getSetHrStatsSince: async () => [],
  } as unknown as Parameters<typeof computeWorkoutHr>[0]
}
const at = (fromMs: number, toMs: number, stepMs: number, source: string) => {
  const out: { timestamp: Date; bpm: number; source: string }[] = []
  for (let t = fromMs; t <= toMs; t += stepMs) out.push({ timestamp: new Date(t), bpm: 110, source })
  return out
}
const run = (readings: ReturnType<typeof at>) =>
  computeWorkoutHr(repoWith(readings), 'u1', { id: 's1', startedAt: START, completedAt: END })

describe('computeWorkoutHr hrDense (#3150)', () => {
  it('a sparse Health Connect span is not dense, however dense its pads', async () => {
    const pads = [...at(START.getTime() - 10 * MIN, START.getTime() - MIN, MIN, 'health_connect'),
                  ...at(END.getTime() + MIN, END.getTime() + 10 * MIN, MIN, 'health_connect')]
    const out = await run([...pads, ...at(START.getTime(), END.getTime(), 10 * MIN, 'health_connect')])
    expect(out!.summary.hrDense).toBe(false)
  })
  it('a dense Health Connect span is dense', async () => {
    expect((await run(at(START.getTime(), END.getTime(), MIN, 'health_connect')))!.summary.hrDense).toBe(true)
  })
  it('a span with no reading has no verdict, even with readings in the pads', async () => {
    const out = await run(at(START.getTime() - 10 * MIN, START.getTime() - MIN, MIN, 'health_connect'))
    expect(out!.summary.readingsCount).toBeGreaterThan(0)
    expect(out!.summary.hrDense).toBeNull()
  })
})
