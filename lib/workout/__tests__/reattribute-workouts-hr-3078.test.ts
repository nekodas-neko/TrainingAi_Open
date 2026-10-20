// #3078: re-attributing the workouts a late heart-rate write overlaps runs oldest first (a session's
// HRR rest bar reads the sessions before it), and one session failing does not stop the rest.
import { describe, expect, it, vi } from 'vitest'
import type { WorkoutRepository } from '@/lib/data/repository'

const computed: string[] = []
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => { throw new Error('not used') } }))
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: async (_repo: unknown, _u: string, ws: { id: string }) => {
    computed.push(ws.id)
    if (ws.id === 'b') throw new Error('pool timeout')
    return { readings: [{ timestamp: new Date(), bpm: 120, source: 'oura_cloud' }], setHrRows: [], summary: { readingsCount: 1 } }
  },
}))

import { reattributeWorkoutsHrInWindow, REATTRIBUTE_MAX_SESSIONS } from '../post-completion-hr'

describe('reattributeWorkoutsHrInWindow', () => {
  const day = (h: number) => new Date(Date.UTC(2026, 9, 18, h - 10))
  const sessions = ['a', 'b', 'c'].map((id, i) => ({ id, startedAt: day(12 + i), completedAt: day(13 + i) }))

  it('asks for the sessions oldest first, keeps going past a failure, and reports it once at the end', async () => {
    const upserted: string[] = []
    let asked: unknown[] = []
    const repo = {
      listCompletedSessionsOverlapping: async (...a: unknown[]) => { asked = a; return sessions },
      upsertWorkoutHrStats: async (_u: string, id: string) => { upserted.push(id) },
      upsertSetHrStats: async () => {},
    } as unknown as WorkoutRepository
    await expect(reattributeWorkoutsHrInWindow(repo, 'u', day(12), day(15), 'Australia/Brisbane'))
      .rejects.toThrow(/1 of 3 sessions failed \(first: pool timeout\)/)
    expect(asked).toEqual(['u', day(12), day(15), REATTRIBUTE_MAX_SESSIONS])
    expect(computed).toEqual(['a', 'b', 'c'])
    expect(upserted).toEqual(['a', 'c'])
  })
})
