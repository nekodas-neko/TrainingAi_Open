import { describe, it, expect } from 'vitest'
import { editStampFromPayload, isSupersededEdit, withEditedAt } from '../edited-at'

// Issue 2721. The pure half of the rule; the SQL half is pinned against Postgres in
// lib/data/postgres/__tests__/push-keeps-newer-workout-log-2721.test.ts.
const T = 1_760_700_000_000

describe('isSupersededEdit', () => {
  const client = (at: number) => ({ kind: 'client' as const, at: new Date(at) })

  it('skips a push only when the row was decided strictly later', () => {
    expect(isSupersededEdit(new Date(T + 1), client(T))).toBe(true)
    expect(isSupersededEdit(new Date(T), client(T))).toBe(false) // the same edit replayed
    expect(isSupersededEdit(new Date(T - 1), client(T))).toBe(false)
  })

  it('never skips against an unstamped row, nor a write that is not a stamped push', () => {
    expect(isSupersededEdit(null, client(T))).toBe(false)
    expect(isSupersededEdit(new Date(T + 1), { kind: 'server' })).toBe(false)
    expect(isSupersededEdit(new Date(T + 1), { kind: 'unstamped' })).toBe(false)
  })
})

describe('editStampFromPayload', () => {
  it('reads editedAt as a client stamp, and its absence as an old client', () => {
    expect(editStampFromPayload({ editedAt: T })).toEqual({ kind: 'client', at: new Date(T) })
    expect(editStampFromPayload({})).toEqual({ kind: 'unstamped' })
  })
})

describe('withEditedAt', () => {
  it('stamps only the workout domains, and keeps an existing stamp', () => {
    expect(withEditedAt('exercise_log_edit', { a: 1 }, T)).toEqual({ a: 1, editedAt: T })
    expect(withEditedAt('mood_logs', { a: 1 }, T)).toEqual({ a: 1 })
    expect(withEditedAt('workout_log', { editedAt: T - 5 }, T)).toEqual({ editedAt: T - 5 })
  })
})
