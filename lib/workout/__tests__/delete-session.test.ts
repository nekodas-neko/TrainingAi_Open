import { describe, it, expect, vi, beforeEach } from 'vitest'

interface RecordedQuery { text: string; params: unknown[] }

function makeClient(rows: Record<string, unknown[]>) {
  const queries: RecordedQuery[] = []
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params })
      // Route canned result sets by a substring of the SQL.
      if (text.includes('SELECT 1 FROM workout_sessions')) return { rows: rows.ownership ?? [] }
      if (text.includes('SELECT DISTINCT el.exercise_name')) return { rows: rows.names ?? [] }
      if (text.includes('SELECT session_id, started_at')) return { rows: rows.session ?? [] }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  return { client, queries }
}

const { getPoolMock, connectMock } = vi.hoisted(() => {
  const connectMock = vi.fn()
  return { connectMock, getPoolMock: vi.fn(() => ({ connect: connectMock })) }
})
vi.mock('@/lib/data/postgres/client', () => ({ getPool: getPoolMock }))

import { deleteWorkoutSession } from '@/lib/workout/delete-session'

describe('deleteWorkoutSession', () => {
  beforeEach(() => { getPoolMock.mockClear(); connectMock.mockReset() })

  it('deletes a user-owned session, scoped to user_id, and returns exercise names', async () => {
    const { client, queries } = makeClient({
      ownership: [{ ok: 1 }],
      names: [{ exercise_name: 'Squat' }, { exercise_name: 'Bench Press' }],
      session: [{ session_id: 'ps-1', started_at: new Date('2026-07-01T08:00:00Z'), completed_at: new Date('2026-07-01T09:00:00Z') }],
    })
    connectMock.mockResolvedValue(client)

    const result = await deleteWorkoutSession('user-1', 'ws-1')

    expect(result).toEqual({ deleted: true, exerciseNames: ['Squat', 'Bench Press'] })

    const ownership = queries.find(q => q.text.includes('SELECT 1 FROM workout_sessions'))!
    expect(ownership.params).toEqual(['ws-1', 'user-1'])

    const del = queries.find(q => q.text.includes('UPDATE workout_sessions'))!
    expect(del.text).toContain('deleted_at')
    expect(del.text).toContain('user_id = $2')
    expect(del.params[0]).toBe('ws-1')
    expect(del.params[1]).toBe('user-1')

    const childEl = queries.find(q => q.text.includes('UPDATE exercise_logs'))!
    expect(childEl.text).toContain('deleted_at')
    expect(childEl.params[0]).toBe('ws-1')

    const childSl = queries.find(q => q.text.includes('UPDATE set_logs'))!
    expect(childSl.text).toContain('deleted_at')

    const counter = queries.find(q => q.text.includes('session_periodization'))!
    expect(counter.text).toContain('sessions_in_phase - 1')
    expect(counter.text).toContain('>= phase_started_at')
    expect(counter.params[0]).toBe('user-1')

    expect(queries.some(q => q.text.includes('BEGIN'))).toBe(true)
    expect(queries.some(q => q.text.includes('COMMIT'))).toBe(true)
    expect(client.release).toHaveBeenCalled()
  })

  it('does not decrement sessions_in_phase for an abandoned (never-completed) session (AI-5)', async () => {
    const { client, queries } = makeClient({
      ownership: [{ ok: 1 }],
      names: [{ exercise_name: 'Squat' }],
      session: [{ session_id: 'ps-1', started_at: new Date('2026-07-01T08:00:00Z'), completed_at: null }],
    })
    connectMock.mockResolvedValue(client)

    const result = await deleteWorkoutSession('user-1', 'ws-1')

    expect(result.deleted).toBe(true)
    expect(queries.some(q => q.text.includes('session_periodization'))).toBe(false)
  })

  it('returns { deleted: false } and issues no DELETE when the session is not owned', async () => {
    const { client, queries } = makeClient({ ownership: [] })
    connectMock.mockResolvedValue(client)

    const result = await deleteWorkoutSession('user-1', 'ws-not-mine')

    expect(result).toEqual({ deleted: false, exerciseNames: [] })
    expect(queries.some(q => q.text.includes('UPDATE workout_sessions'))).toBe(false)
    expect(client.release).toHaveBeenCalled()
  })
})
