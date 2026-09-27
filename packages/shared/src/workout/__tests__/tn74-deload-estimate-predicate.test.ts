import { describe, it, expect } from 'vitest'
import { isDeloadedForEstimate } from '../log-exercise'

/**
 * TN-74 — the predicate that decides whether an exercise's 1RM estimate is suppressed had two
 * copies, server and client, and the client's is what the DEVICE stores for a set logged offline.
 *
 * They agreed, which is why nothing had broken. The reason to make them one function is what they
 * decide: `estimated_1rm > 0` **is** the deload test (`adapter.ts`), so a drift would not surface
 * as a wrong number on a screen — it would surface as an offline-logged exercise disagreeing with
 * the server about whether a deload happened.
 */
describe('isDeloadedForEstimate (TN-74)', () => {
  it('suppresses on a per-exercise deload, whatever the session is doing', () => {
    expect(isDeloadedForEstimate({ exerciseDeloaded: true, isAnyDeload: false, isBaseline: false })).toBe(true)
    expect(isDeloadedForEstimate({ exerciseDeloaded: true, isAnyDeload: true, isBaseline: false })).toBe(true)
  })

  it('suppresses on a session or phase deload with no per-exercise flag', () => {
    // This is the Q-298 case: a PHASE deload zeroes the estimate, and the row used to be stamped
    // `exercise_deloaded = false` about work the app had just declined to estimate.
    expect(isDeloadedForEstimate({ exerciseDeloaded: false, isAnyDeload: true, isBaseline: false })).toBe(true)
    expect(isDeloadedForEstimate({ isAnyDeload: true, isBaseline: false })).toBe(true)
  })

  it('exempts a baseline test from a session deload — the carve-out both copies already had', () => {
    // A baseline is a genuine max-effort attempt even inside a deload window.
    expect(isDeloadedForEstimate({ exerciseDeloaded: false, isAnyDeload: true, isBaseline: true })).toBe(false)
  })

  it('does NOT exempt a baseline from an explicit per-exercise deload', () => {
    // The two flags are not symmetric, and collapsing them would be the tempting simplification:
    // `isBaseline` overrides the session-level signal only. An exercise the user explicitly
    // deloaded is deloaded whatever else is true.
    expect(isDeloadedForEstimate({ exerciseDeloaded: true, isAnyDeload: true, isBaseline: true })).toBe(true)
  })

  it('is false when nothing is deloading', () => {
    expect(isDeloadedForEstimate({ exerciseDeloaded: false, isAnyDeload: false, isBaseline: false })).toBe(false)
    expect(isDeloadedForEstimate({ isAnyDeload: false, isBaseline: true })).toBe(false)
  })

  it('treats an absent per-exercise flag as not-deloaded, never as unknown', () => {
    // The field is optional on the payload; `undefined` must read as false rather than as truthy.
    expect(isDeloadedForEstimate({ exerciseDeloaded: undefined, isAnyDeload: false, isBaseline: false })).toBe(false)
  })
})
