// #3896 step 2 — `query` on the "exercises" choice source: only the program's exercises whose name
// holds the user's words, every exercise when nothing matches, and bounded input.
import { describe, it, expect, vi } from 'vitest'

const program = {
  sessions: [
    { id: 's1', name: 'Upper', position: 0, exercises: [
      { id: 'e1', exerciseName: 'Cable Lat Pulldown', position: 0 },
      { id: 'e2', exerciseName: 'Straight Arm Pulldown', position: 1 },
      { id: 'e3', exerciseName: 'Bench Press', position: 2 },
    ] },
    { id: 's2', name: 'Lower', position: 1, exercises: [{ id: 'e4', exerciseName: 'Squat', position: 0 }] },
  ],
}

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ getActiveProgram: async () => program }) }))

import { GET } from '@/app/api/coach/options/route'
import { matchesExerciseQuery } from '@/lib/coach/exercise-query'

const ids = async (query?: string) => {
  const qs = new URLSearchParams({ source: 'exercises', ...(query !== undefined ? { query } : {}) })
  const res = await GET(new Request(`http://localhost/api/coach/options?${qs}`))
  return { status: res.status, ids: res.ok ? (await res.json()).options.map((o: { id: string }) => o.id) : null }
}

describe('the exercises source takes a query (#3896)', () => {
  it('keeps only the names holding every word, in any order and case', async () => {
    expect((await ids('pulldown')).ids).toEqual(['e1', 'e2'])
    expect((await ids('PULLDOWN cable')).ids).toEqual(['e1'])
  })
  it('falls back to every exercise when nothing matches, and when no query is given', async () => {
    expect((await ids('jefferson curl')).ids).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect((await ids()).ids).toEqual(['e1', 'e2', 'e3', 'e4'])
  })
  it('treats regex characters as text and refuses an over-long query', async () => {
    expect(matchesExerciseQuery('Bench Press', '.*')).toBe(false)
    expect((await ids('x'.repeat(61))).status).toBe(400)
  })
})
