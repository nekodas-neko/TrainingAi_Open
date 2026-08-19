import { describe, it, expect } from 'vitest'
import { MutationSchema } from '../mutation-schema'

/**
 * Q-496 — the envelope's `date` regex bounds the SHAPE only.
 *
 * Measured before this guard: a `day_checkins` mutation dated `2026-13-45` passed validation,
 * reached the driver, and `/api/sync/push` echoed the entire failed INSERT statement back to the
 * caller — the Q-320 leak class, reached through a date rather than through a catch. The mutation
 * also dead-lettered for a reason no client could read.
 */
const base = { id: 'm1', domain: 'day_checkins' as const, payload: { phase: 'evening' } }

describe('MutationSchema.date rejects a shape-passing non-date (Q-496)', () => {
  it('refuses the values that reached the driver', () => {
    for (const date of ['2026-13-45', '2026-02-31', '0000-00-00', '2026-02-29']) {
      expect(MutationSchema.safeParse({ ...base, date }).success).toBe(false)
    }
  })

  it('still accepts a real day in either separator', () => {
    for (const date of ['2026-08-17', '2026/08/17', '2024-02-29']) {
      expect(MutationSchema.safeParse({ ...base, date }).success).toBe(true)
    }
  })

  // The route drops a mutation that fails this schema and omits it from the response errors, so the
  // client treats it as quarantined rather than re-pushing forever. That per-item handling already
  // existed; this guard moves the rejection ahead of the driver.
  it('fails on the date field specifically', () => {
    const r = MutationSchema.safeParse({ ...base, date: '2026-13-45' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['date'])
  })
})
