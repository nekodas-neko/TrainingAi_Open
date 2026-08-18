import { describe, it, expect } from 'vitest'
import { runningPlanExplainCacheKey } from '../prescribed-run-explain-key'

/**
 * Q-469 — the card re-asked the model for the same sentence on every mount: 31 redundant calls
 * across 9 distinct runs, the same run explained about seven times, worded differently each time.
 * The fix is a cache, so the only thing that can make it wrong is the key.
 *
 * These assert the property the key has to hold: it changes **exactly when the sentence should**.
 * Too loose and a stale sentence outlives its prescription; too tight and the redundant calls come
 * straight back.
 */
const base = {
  date: '2026-08-18',
  type: 'easy' as const,
  durationMin: 40,
  gateKey: 'readiness low',
  rationale: 'Your readiness is down, so keep it conversational.',
}

describe('runningPlanExplainCacheKey', () => {
  it('is stable for the same prescription on the same day — which is what stops the re-asking', () => {
    expect(runningPlanExplainCacheKey(base)).toBe(runningPlanExplainCacheKey({ ...base }))
  })

  // Each of these changes what the sentence should say, so each must miss the cache.
  it.each([
    ['the day', { date: '2026-08-19' }],
    ['the run type', { type: 'tempo' as const }],
    ['the duration', { durationMin: 60 }],
    ['the gate reasons', { gateKey: 'readiness low|sleep short' }],
    ['the rationale', { rationale: 'You are fresh — push the pace.' }],
  ])('changes when %s changes', (_what, patch) => {
    expect(runningPlanExplainCacheKey({ ...base, ...patch })).not.toBe(runningPlanExplainCacheKey(base))
  })

  it('is day-scoped, so yesterday\'s sentence cannot describe today\'s run', () => {
    expect(runningPlanExplainCacheKey(base)).toContain('2026-08-18')
  })

  it('distinguishes a missing duration from a zero one', () => {
    expect(runningPlanExplainCacheKey({ ...base, durationMin: null }))
      .not.toBe(runningPlanExplainCacheKey({ ...base, durationMin: 0 }))
  })
})
