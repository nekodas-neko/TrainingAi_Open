import { describe, it, expect } from 'vitest'
import { editStampFromPayload, isSupersededEdit, PushedEditedAtSchema, withEditedAt } from '../edited-at'
import { INGEST_FUTURE_TOLERANCE_MS } from '../../validation/ingest-clock'

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
    expect(editStampFromPayload({ editedAt: T }, T)).toEqual({ kind: 'client', at: new Date(T) })
    expect(editStampFromPayload({}, T)).toEqual({ kind: 'unstamped' })
  })

  it('caps a stamp ahead of the server at now plus the ingest future tolerance', () => {
    const y2090 = Date.parse('2090-01-01T00:00:00Z')
    expect(editStampFromPayload({ editedAt: y2090 }, T)).toEqual({ kind: 'client', at: new Date(T + INGEST_FUTURE_TOLERANCE_MS) })
    // Inside the tolerance, ordinary skew, it is kept as sent.
    expect(editStampFromPayload({ editedAt: T + 1_000 }, T)).toEqual({ kind: 'client', at: new Date(T + 1_000) })
  })

  it('a later honest edit beats a row a 2090 stamp was clamped onto', () => {
    const clamped = editStampFromPayload({ editedAt: Date.parse('2090-01-01T00:00:00Z') }, T)
    if (clamped.kind !== 'client') throw new Error('expected a client stamp')
    const later = T + 2 * INGEST_FUTURE_TOLERANCE_MS
    expect(isSupersededEdit(clamped.at, editStampFromPayload({ editedAt: later }, later))).toBe(false)
  })

  it('an out-of-range stamp reads as unstamped', () => {
    expect(editStampFromPayload({ editedAt: 0 }, T)).toEqual({ kind: 'unstamped' })
    expect(editStampFromPayload({ editedAt: 5_000_000_000_000 }, T)).toEqual({ kind: 'unstamped' })
    expect(editStampFromPayload({ editedAt: T + 0.5 }, T)).toEqual({ kind: 'unstamped' })
  })
})

describe('PushedEditedAtSchema', () => {
  it('passes a good stamp and turns a bad one into absent, never a parse failure', () => {
    expect(PushedEditedAtSchema.parse(T)).toBe(T)
    expect(PushedEditedAtSchema.parse(undefined)).toBeUndefined()
    for (const bad of [0, -1, 5_000_000_000_000, 1.5, 'yesterday', null, Number.NaN]) {
      expect(PushedEditedAtSchema.safeParse(bad)).toEqual({ success: true, data: undefined })
    }
  })
})

describe('withEditedAt', () => {
  it('stamps only the workout domains, and keeps an existing stamp', () => {
    expect(withEditedAt('exercise_log_edit', { a: 1 }, T)).toEqual({ a: 1, editedAt: T })
    expect(withEditedAt('mood_logs', { a: 1 }, T)).toEqual({ a: 1 })
    expect(withEditedAt('workout_log', { editedAt: T - 5 }, T)).toEqual({ editedAt: T - 5 })
  })
})
