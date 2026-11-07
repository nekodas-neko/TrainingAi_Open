// Issue 3666: an AI per-exercise deload stores `estimated_1rm = 0`, `exercise_deloaded = true` and
// no `phase_type`. The route read only the session's deload flags, so such a row came back as an
// ordinary session with a 1RM of 0, and Preview plotted it.
import { describe, it, expect, vi } from 'vitest'
import type { ExerciseHistoryLogRow } from '@trainingai/shared/types/log'
import { isEstimatedOneRm } from '@trainingai/shared/1rm'

const row = (over: Partial<ExerciseHistoryLogRow>): ExerciseHistoryLogRow => ({
  id: 'log', loggedAt: new Date('2026-11-04T02:00:00Z'), sessionName: 'Upper',
  estimated1rm: 100, volume: 2000, isEarlyDeload: false, exerciseDeloaded: false,
  sets: [{ weightKg: 70, reps: 8 }], ...over,
})
const rows = [
  row({ id: 'a' }),
  row({ id: 'b', estimated1rm: 0, exerciseDeloaded: true }),
  row({ id: 'c', phaseType: 'deload', estimated1rm: 0 }),
  row({ id: 'd', isEarlyDeload: true, estimated1rm: 0 }),
]

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getExerciseHistoryRows: async () => rows,
    listExerciseLibrary: async () => [],
  }),
}))

import { NextRequest } from 'next/server'

describe('GET /api/exercise-history deload rows (issue 3666)', () => {
  it('marks a per-exercise deload as a deload session', async () => {
    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://x/api/exercise-history?name=Bench'))
    const body = await res.json() as { entries: { isDeload: boolean; estimated1rm: number | null }[] }
    expect(body.entries.map(e => e.isDeload)).toEqual([false, true, true, true])
    // The trend both apps draw keeps only the real estimate.
    expect(body.entries.map(e => e.estimated1rm).filter(isEstimatedOneRm)).toEqual([100])
  })
})
