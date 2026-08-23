import { describe, it, expect } from 'vitest'
import { IngestBodySchema } from '../health-connect-ingest'
import { WEIGHT_KG_MIN } from '../body-metrics'

/**
 * Q-495 — `z.coerce.number()` runs `Number(v)` on anything, and `Number()` turns several non-numbers
 * into a *valid-looking* reading rather than an error.
 *
 * Measured against the running route before this guard, each stored and stamped `health_connect`:
 *   {"steps":[]}       -> steps 0
 *   {"steps":true}     -> steps 1
 *   {"weightKg":""}    -> weight 0 kg
 *   {"weightKg":[]}    -> weight 0 kg
 */
const ok = (patch: Record<string, unknown>) =>
  IngestBodySchema.safeParse({ secret: 's', date: '2026-08-16', ...patch }).success

describe('IngestBodySchema rejects laundered numbers (Q-495)', () => {
  it('refuses the four values that stored as readings', () => {
    expect(ok({ steps: [] })).toBe(false)
    expect(ok({ steps: true })).toBe(false)
    expect(ok({ weightKg: '' })).toBe(false)
    expect(ok({ weightKg: [] })).toBe(false)
  })

  it('refuses the other shapes Number() would launder', () => {
    expect(ok({ steps: {} })).toBe(false)
    expect(ok({ steps: false })).toBe(false)
    expect(ok({ steps: '  ' })).toBe(false)
    expect(ok({ steps: [5] })).toBe(false)   // Number([5]) === 5
  })

  // The obvious fix is plain `z.number()`, and it is the one change here that could break the live
  // integration: Tasker builds this body by string concatenation, so a quoted number is a plausible
  // shape for it to send and there is no way to confirm which from a sandbox. Numeric strings stay.
  it('still accepts a numeric string, which the live client may well send', () => {
    expect(ok({ steps: '4200' })).toBe(true)
    expect(ok({ weightKg: '72.8' })).toBe(true)
  })

  it('still accepts real JSON numbers', () => {
    expect(ok({ steps: 4200 })).toBe(true)
    expect(ok({ weightKg: 72.8 })).toBe(true)
    expect(ok({ calories: 2100, protein: 150, carb: 200, fat: 70, distanceKm: 5.2 })).toBe(true)
  })

  it('keeps rejecting what the route already rejected', () => {
    expect(ok({ weightKg: '75kg' })).toBe(false)
    expect(ok({ weightKg: 1e308 })).toBe(false)
  })

  it('leaves an omitted or explicitly null field alone', () => {
    expect(ok({})).toBe(true)
    expect(ok({ weightKg: null })).toBe(true)
  })
})

describe('IngestBodySchema gives body weight a plausible floor (Q-495)', () => {
  // A 0 kg body weight is as much "clearly garbage" as the stringified `75kg` this route already
  // rejected, and it is the value `getMostRecentConfirmedWeightKg` would then serve to the scale
  // pipeline and to `deriveActivityKcal`.
  it('rejects zero and anything under the shared floor', () => {
    expect(ok({ weightKg: 0 })).toBe(false)
    expect(ok({ weightKg: WEIGHT_KG_MIN - 1 })).toBe(false)
    expect(WEIGHT_KG_MIN).toBe(20)
  })

  // Checked against production rather than assumed: 114 body_metrics rows, none at weight 0, none
  // under 20 kg, none at body-fat 0 or steps 0, min weight 67.55. Tasker omits a field it has no
  // reading for, so a floor cannot 400 a real push.
  it('accepts the range the real pipeline actually produces', () => {
    expect(ok({ weightKg: WEIGHT_KG_MIN })).toBe(true)
    expect(ok({ weightKg: 67.55 })).toBe(true)
    expect(ok({ weightKg: 72.8 })).toBe(true)
  })
})
