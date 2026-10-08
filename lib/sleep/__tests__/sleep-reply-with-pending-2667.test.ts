// Issue 2667 — the handling Home and Health share for a `/api/sleep-sessions` reply.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ store: null as null | Record<string, unknown> }))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => h.store }))

import { sleepReplyWithPending } from '../manual-night-view'

const row = (id: string, date: string, manualEntry = false) => ({
  id, date, manualEntry, durationHours: 7, sleepStart: `${date}T12:00:00.000Z`, sleepEnd: `${date}T20:00:00.000Z`,
})
const queued = (id: string) => [{ domain: 'manual_sleep', payload: { id, deleted: true } }]

beforeEach(() => { h.store = null })

describe('sleepReplyWithPending', () => {
  it('drops a night with a pending removal', async () => {
    h.store = { getSleepSessions: async () => [], getQueuedMutationsForDomain: async () => queued('m1') }
    const out = await sleepReplyWithPending([row('d1', '2026-10-06'), row('m1', '2026-10-07', true)], 'u', 'Australia/Brisbane')
    expect(out.map(r => r.id)).toEqual(['d1'])
  })

  it('adds a typed night the server reply does not have yet', async () => {
    h.store = {
      getSleepSessions: async () => [{ ...row('m2', '2026-10-07', true), manualSleepStart: null }],
      getQueuedMutationsForDomain: async () => [],
    }
    const out = await sleepReplyWithPending([row('d1', '2026-10-06')], 'u', 'Australia/Brisbane')
    expect(out.map(r => r.id)).toEqual(['m2', 'd1'])
  })

  it('passes the reply through unchanged with no store, no user, or nothing pending', async () => {
    const reply = [row('d2', '2026-10-07'), row('d1', '2026-10-06')]
    const json = JSON.stringify(reply)
    expect(JSON.stringify(await sleepReplyWithPending(reply, 'u', 'Australia/Brisbane'))).toBe(json)
    h.store = { getSleepSessions: async () => [], getQueuedMutationsForDomain: async () => [] }
    expect(JSON.stringify(await sleepReplyWithPending(reply, 'u', 'Australia/Brisbane'))).toBe(json)
    expect(JSON.stringify(await sleepReplyWithPending(reply, undefined, 'Australia/Brisbane'))).toBe(json)
  })

  it('a reply that is not a list (an error body, null) is an empty list', async () => {
    expect(await sleepReplyWithPending(null, 'u', 'Australia/Brisbane')).toEqual([])
    expect(await sleepReplyWithPending({ error: 'x' }, 'u', 'Australia/Brisbane')).toEqual([])
  })
})
